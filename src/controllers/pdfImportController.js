// Lets a teacher upload a PDF (an exam paper, a question sheet, anything
// with exam-style questions in it) and have AI read it, pull out every
// question it can find, and convert each into the same MCQ shape used
// everywhere else in the app (question_text, 4 options, correct_letter,
// explanation, difficulty) — classified into whichever of the existing
// topics fits best. The result is inserted straight into the `questions`
// table, exactly like a manually-added question, so it reaches students
// on their next sync — no separate review/approval table needed since
// that's how every other question already gets published.
//
// The PDF is sent to Gemini directly as a document (not text-extracted
// first) so this works on scanned/image-based exam papers too, not just
// ones with a clean embedded text layer.
const pool = require('../config/db');
const { callGemini } = require('../utils/gemini');

function buildPrompt(topics) {
  const topicList = topics.map((t) => `- "${t.title}"`).join('\n');
  return `You will be given a PDF containing exam or practice questions
(Rwandan REB O-Level Biology). It may include a marking scheme/answer key —
use it to get the correct answer exactly right when present.

For EVERY question you can find, output one JSON object with this exact shape:
{
  "topic_title": "<the single best-matching topic from the list below>",
  "question_text": "<the question, cleaned up>",
  "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
  "correct_letter": "A" | "B" | "C" | "D",
  "explanation": "<one short sentence, or null>",
  "difficulty": 1 | 2 | 3
}

Available topics (use one of these exactly, verbatim):
${topicList}

Rules:
- If a question in the source is NOT already multiple-choice, write 4 plausible
  options yourself (one correct, three realistic wrong answers a Biology
  student might pick), based only on the correct content — never invent a
  fact you are not confident about.
- If an answer key/marking scheme is present in the PDF, use it as the source
  of truth for the correct answer and to write the explanation.
- difficulty: 1 = recall/simple fact, 2 = applying a concept, 3 = multi-step reasoning.
- Skip anything that isn't really a question (instructions, headers, page numbers,
  cover page details).
- Output ONLY a JSON array of these objects. No preamble, no markdown fences, no commentary.`;
}

function extractJsonArray(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('[');
  if (start === -1) return null;

  // Try a straightforward parse first (covers the normal, complete case).
  const end = cleaned.lastIndexOf(']');
  if (end !== -1) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // fall through to salvage attempt below
    }
  }

  // Output was likely cut off mid-object (hit the token limit). Salvage
  // every complete {...} object up to the last one that actually closed,
  // rather than losing the whole batch over one unfinished entry at the end.
  const body = cleaned.slice(start + 1);
  const lastCompleteObjectEnd = body.lastIndexOf('}');
  if (lastCompleteObjectEnd === -1) return null;
  try {
    return JSON.parse(`[${body.slice(0, lastCompleteObjectEnd + 1)}]`);
  } catch {
    return null;
  }
}

async function importPdf(req, res) {
  if (!req.file) return res.status(400).json({ error: 'A PDF file is required (field name: file)' });

  const { paper_title, paper_year } = req.body;

  try {
    const { rows: topics } = await pool.query('SELECT id, title FROM topics ORDER BY order_index ASC');
    if (!topics.length) {
      return res.status(500).json({ error: 'No topics exist yet — seed topics before importing questions.' });
    }

    const responseText = await callGemini(
      [
        { text: buildPrompt(topics) },
        { inlineData: { mimeType: 'application/pdf', data: req.file.buffer.toString('base64') } },
      ],
      { maxOutputTokens: 32000 }
    );

    const extracted = extractJsonArray(responseText);
    if (!extracted || !Array.isArray(extracted)) {
      return res.status(502).json({
        error: 'AI did not return a readable question list. Try again, or a clearer PDF.',
        raw_preview: responseText.slice(0, 1500),
        raw_length: responseText.length,
      });
    }

    // Optionally file everything under one past_paper record so students
    // see where these questions came from (e.g. "Mock Exam — March 2026").
    let pastPaperId = null;
    if (paper_title) {
      const { rows } = await pool.query(
        `INSERT INTO past_papers (title, year, topic_id, uploaded_by)
         VALUES ($1, $2, NULL, $3) RETURNING id`,
        [paper_title, paper_year ? parseInt(paper_year, 10) : null, req.user.id]
      );
      pastPaperId = rows[0].id;
    }

    const topicByTitle = Object.fromEntries(topics.map((t) => [t.title.trim().toLowerCase(), t.id]));

    let inserted = 0;
    let skippedDuplicate = 0;
    let skippedUnclassified = 0;
    const unclassified = [];

    for (const q of extracted) {
      const topicId = topicByTitle[(q.topic_title || '').trim().toLowerCase()];
      if (!topicId || !q.question_text || !['A', 'B', 'C', 'D'].includes(q.correct_letter)) {
        skippedUnclassified++;
        unclassified.push(q.question_text || '(unreadable question)');
        continue;
      }

      const { rows: existing } = await pool.query(
        `SELECT id FROM questions WHERE topic_id = $1 AND question_text = $2 LIMIT 1`,
        [topicId, q.question_text]
      );
      if (existing.length) {
        skippedDuplicate++;
        continue;
      }

      const options = { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d };
      await pool.query(
        `INSERT INTO questions (topic_id, past_paper_id, question_text, question_type, options, correct_answer, explanation, difficulty, created_by)
         VALUES ($1,$2,$3,'mcq',$4,$5,$6,$7,$8)`,
        [topicId, pastPaperId, q.question_text, JSON.stringify(options), q.correct_letter,
         q.explanation || null, [1, 2, 3].includes(q.difficulty) ? q.difficulty : 2, req.user.id]
      );
      inserted++;
    }

    res.status(201).json({
      total_found: extracted.length,
      inserted,
      skipped_duplicate: skippedDuplicate,
      skipped_unclassified: skippedUnclassified,
      unclassified_preview: unclassified.slice(0, 5),
      past_paper_id: pastPaperId,
    });
  } catch (err) {
    if (err.isConfigError) {
      return res.status(503).json({ error: 'AI import is not configured on this server (missing GEMINI_API_KEY)' });
    }
    console.error(err);
    res.status(500).json({ error: 'PDF import failed', detail: err.message });
  }
}

module.exports = { importPdf };

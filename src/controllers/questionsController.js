const pool = require('../config/db');
const { toAppShape } = require('../utils/questionShape');
const { callGemini } = require('../utils/gemini');

// Given just a question (and optionally its topic), asks Gemini to draft
// 4 plausible MCQ options, the correct one, and a short explanation — the
// teacher reviews and edits this before saving, it's never inserted
// automatically.
async function generateAnswer(req, res) {
  const { question_text, topic_title } = req.body;
  if (!question_text) {
    return res.status(400).json({ error: 'question_text is required' });
  }

  const systemPrompt = `You write multiple-choice questions for REB O-Level Biology students in Rwanda.
Given a question (and optionally its topic), respond with ONLY a JSON object, no other text, no markdown fences:
{"option_a":"...","option_b":"...","option_c":"...","option_d":"...","correct_letter":"A|B|C|D","explanation":"one short sentence"}
Keep options short, plausible, and at O-Level difficulty. Make exactly one option correct.`;

  const userPrompt = topic_title
    ? `Topic: ${topic_title}\nQuestion: ${question_text}`
    : `Question: ${question_text}`;

  try {
    const raw = await callGemini(`${systemPrompt}\n\n${userPrompt}`, { maxOutputTokens: 1500 });

    let parsed;
    try {
      // Strip accidental markdown fences before parsing, just in case.
      const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('AI generation returned non-JSON:', raw);
      return res.status(502).json({ error: 'AI response could not be parsed. Try again or fill in the answer manually.' });
    }

    res.json({
      options: {
        A: parsed.option_a, B: parsed.option_b,
        C: parsed.option_c, D: parsed.option_d,
      },
      correct_letter: parsed.correct_letter,
      explanation: parsed.explanation,
    });
  } catch (err) {
    if (err.isConfigError) {
      return res.status(503).json({ error: 'AI generation is not configured on this server (missing GEMINI_API_KEY)' });
    }
    console.error(err);
    res.status(502).json({ error: 'AI generation request failed', detail: err.message });
  }

}

async function listQuestions(req, res) {
  const { topic_id, past_paper_id } = req.query;
  const params = [];
  const clauses = [];
  if (topic_id) { params.push(topic_id); clauses.push(`topic_id = $${params.length}`); }
  if (past_paper_id) { params.push(past_paper_id); clauses.push(`past_paper_id = $${params.length}`); }
  let sql = 'SELECT * FROM questions';
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows.map(toAppShape));
}

async function createQuestion(req, res) {
  const {
    topic_id, past_paper_id, question_text, question_type,
    options, correct_answer, explanation, difficulty,
  } = req.body;

  if (!question_text || !correct_answer) {
    return res.status(400).json({ error: 'question_text and correct_answer are required' });
  }

  const { rows } = await pool.query(
    `INSERT INTO questions
      (topic_id, past_paper_id, question_text, question_type, options, correct_answer, explanation, difficulty, created_by)
     VALUES ($1,$2,$3,COALESCE($4,'mcq'),$5,$6,$7,COALESCE($8,2),$9)
     RETURNING *`,
    [topic_id || null, past_paper_id || null, question_text, question_type,
     options ? JSON.stringify(options) : null, correct_answer, explanation || null,
     difficulty, req.user.id]
  );
  res.status(201).json(rows[0]);
}

// Bulk export endpoint: lets the mobile app pull the full offline-cacheable
// question bank (with answers/explanations) in one request after login.
async function exportBank(req, res) {
  const { rows } = await pool.query(
    `SELECT q.*, t.title AS topic_title
     FROM questions q
     LEFT JOIN topics t ON t.id = q.topic_id
     ORDER BY t.order_index ASC, q.created_at ASC`
  );
  const questions = rows.map((r) => ({ ...toAppShape(r), topic_title: r.topic_title }));
  res.json({ exported_at: new Date().toISOString(), count: questions.length, questions });
}

module.exports = { listQuestions, createQuestion, exportBank, generateAnswer };

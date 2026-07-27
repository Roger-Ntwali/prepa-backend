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
  const { topic_id, past_paper_id, include_archived } = req.query;
  const params = [];
  // Archived questions stay out of every listing unless explicitly asked
  // for, so the student app and the portal never serve a retired question.
  const clauses = include_archived === 'true' ? [] : ['archived_at IS NULL'];
  if (topic_id) { params.push(topic_id); clauses.push(`topic_id = $${params.length}`); }
  if (past_paper_id) { params.push(past_paper_id); clauses.push(`past_paper_id = $${params.length}`); }
  let sql = 'SELECT * FROM questions';
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows.map(toAppShape));
}

// Removing a question is not a plain DELETE. attempt_answers.question_id is
// ON DELETE CASCADE, so dropping a question students have answered would
// take those answers with it and silently rewrite past scores and every
// topic-accuracy figure built on them.
//
// So: if the question has been answered, archive it — it vanishes from the
// bank and from the app, while the history it underpins stays intact. If
// nobody has ever answered it, there is nothing to preserve and it is
// deleted outright.
async function deleteQuestion(req, res) {
  const { id } = req.params;

  const existing = await pool.query(
    'SELECT id, archived_at FROM questions WHERE id = $1',
    [id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ error: 'Question not found' });
  }

  const answered = await pool.query(
    'SELECT 1 FROM attempt_answers WHERE question_id = $1 LIMIT 1',
    [id]
  );

  if (answered.rows.length) {
    await pool.query(
      'UPDATE questions SET archived_at = now() WHERE id = $1',
      [id]
    );
    return res.json({
      id,
      action: 'archived',
      message:
        'Students have already answered this question, so it was archived instead of deleted. It no longer appears in the bank, in quizzes, or in the app, and past results are unchanged.',
    });
  }

  // quiz_questions cascades on its own; nothing else references the row.
  await pool.query('DELETE FROM questions WHERE id = $1', [id]);
  res.json({ id, action: 'deleted', message: 'Question deleted.' });
}

async function restoreQuestion(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(
    'UPDATE questions SET archived_at = NULL WHERE id = $1 RETURNING id',
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Question not found' });
  res.json({ id, action: 'restored', message: 'Question restored to the bank.' });
}

async function createQuestion(req, res) {
  const {
    topic_id, past_paper_id, question_text, question_type,
    options, correct_answer, explanation, difficulty,
  } = req.body;

  if (!question_text || !correct_answer) {
    return res.status(400).json({ error: 'question_text and correct_answer are required' });
  }

  try {
    // COALESCE($4,'mcq') alone errors ("column is of type question_type
    // but expression is of type text") when $4 is omitted -- an untyped
    // null parameter next to an enum literal doesn't get the column's
    // type inferred for it, and Postgres refuses the implicit cast. The
    // request had no try/catch here either, so that error previously left
    // the connection open with no response ever sent back to the caller.
    const { rows } = await pool.query(
      `INSERT INTO questions
        (topic_id, past_paper_id, question_text, question_type, options, correct_answer, explanation, difficulty, created_by)
       VALUES ($1,$2,$3,$4::question_type,$5,$6,$7,COALESCE($8,2),$9)
       RETURNING *`,
      [topic_id || null, past_paper_id || null, question_text, question_type || 'mcq',
       options ? JSON.stringify(options) : null, correct_answer, explanation || null,
       difficulty, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create question' });
  }
}

// Bulk export endpoint: lets the mobile app pull the full offline-cacheable
// question bank (with answers/explanations) in one request after login.
async function exportBank(req, res) {
  const { rows } = await pool.query(
    `SELECT q.*, t.title AS topic_title
     FROM questions q
     LEFT JOIN topics t ON t.id = q.topic_id
     WHERE q.archived_at IS NULL
     ORDER BY t.order_index ASC, q.created_at ASC`
  );
  const questions = rows.map((r) => ({ ...toAppShape(r), topic_title: r.topic_title }));
  res.json({ exported_at: new Date().toISOString(), count: questions.length, questions });
}

module.exports = {
  listQuestions, createQuestion, exportBank, generateAnswer,
  deleteQuestion, restoreQuestion,
};

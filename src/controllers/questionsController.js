const pool = require('../config/db');
const { toAppShape } = require('../utils/questionShape');
const { callGemini } = require('../utils/gemini');
const { parsePageLimit } = require('../utils/pagination');

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
  const { topic_id, past_paper_id, include_archived, page, search } = req.query;
  const params = [];
  // Archived questions stay out of every listing unless explicitly asked
  // for, so the student app and the portal never serve a retired question.
  const clauses = include_archived === 'true' ? [] : ['archived_at IS NULL'];
  if (topic_id) { params.push(topic_id); clauses.push(`topic_id = $${params.length}`); }
  if (past_paper_id) { params.push(past_paper_id); clauses.push(`past_paper_id = $${params.length}`); }
  // Only meaningful once paginated -- the portal's search box used to
  // filter client-side over the full bank, which silently stopped working
  // once only one page of rows was ever fetched.
  if (search) { params.push(`%${search}%`); clauses.push(`question_text ILIKE $${params.length}`); }
  let sql = 'SELECT * FROM questions';
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  // Pagination is opt-in (only when ?page is sent) so the mobile app's
  // existing full-bank fetch (it never sends page/limit) is untouched --
  // the body stays a bare array either way; total count rides on a header
  // instead of changing the response shape.
  if (page) {
    const { limit, offset } = parsePageLimit(req);
    const countSql = clauses.length
      ? `SELECT COUNT(*)::int AS total FROM questions WHERE ${clauses.join(' AND ')}`
      : 'SELECT COUNT(*)::int AS total FROM questions';
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
      pool.query(countSql, params),
    ]);
    res.set('X-Total-Count', String(countRows[0].total));
    return res.json(rows.map(toAppShape));
  }

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

// Single-question fetch in raw storage shape (options as {A,B,C,D},
// correct_answer as a letter) -- the portal's edit form needs this exact
// shape to pre-fill, unlike listQuestions' toAppShape output (options as
// an ordered array, correct_answer as answer text) which was built for the
// mobile app and can't be reliably reverse-engineered (duplicate option
// text would make matching text back to a letter ambiguous). answer_count
// lets the portal warn/lock the answer fields before the teacher even
// tries to save, not just on a failed PATCH.
async function getQuestion(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM questions WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Question not found' });

  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM attempt_answers WHERE question_id = $1',
    [id]
  );
  res.json({ ...rows[0], answer_count: countRows[0].count });
}

// JSONB doesn't preserve object key order (Postgres normalizes it on
// storage), so comparing the freshly-stringified request body against a
// stringified round-trip from the DB would false-positive on "changed"
// for identical options whose keys just got reordered in storage. Compare
// by value instead.
function optionsEqual(a, b) {
  if (!a || !b) return a === b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

// Free to edit regardless of history: wording, explanation, difficulty,
// topic. NOT free to edit once answered: options/correct_answer -- a
// student's attempt_answers.is_correct was computed against the answer
// key as it existed at the time, and changing that key here would make
// their (unchangeable) recorded answer disagree with what the question
// now says was correct. Rather than let that drift silently, the update
// is rejected outright when the request actually changes either field
// and the question has been answered -- the same "archive/block instead
// of silently rewriting history" policy deleteQuestion already applies.
// Re-submitting the same options/correct_answer the question already has
// is not a "change" and goes through fine -- the portal's edit form
// always resubmits every field, so this matters for real usage, not just
// an edge case.
async function updateQuestion(req, res) {
  const { id } = req.params;
  const {
    topic_id, past_paper_id, question_text, question_type,
    options, correct_answer, explanation, difficulty,
  } = req.body;

  if (!question_text || !correct_answer) {
    return res.status(400).json({ error: 'question_text and correct_answer are required' });
  }

  const existingRes = await pool.query('SELECT * FROM questions WHERE id = $1', [id]);
  if (!existingRes.rows.length) return res.status(404).json({ error: 'Question not found' });
  const existing = existingRes.rows[0];

  const answerChanged =
    !optionsEqual(options, existing.options) || correct_answer !== existing.correct_answer;

  if (answerChanged) {
    const answered = await pool.query(
      'SELECT 1 FROM attempt_answers WHERE question_id = $1 LIMIT 1',
      [id]
    );
    if (answered.rows.length) {
      return res.status(409).json({
        error:
          "Students have already answered this question, so its options and correct answer are locked -- changing them would make those recorded answers disagree with what the question now says was correct. You can still edit the wording, explanation, difficulty, or topic. To fix a wrong answer key, archive this question and add a corrected one instead.",
      });
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE questions SET
         topic_id = $1, past_paper_id = $2, question_text = $3,
         question_type = $4::question_type, options = $5, correct_answer = $6,
         explanation = $7, difficulty = COALESCE($8, 2)
       WHERE id = $9
       RETURNING *`,
      [topic_id || null, past_paper_id || null, question_text, question_type || 'mcq',
       options ? JSON.stringify(options) : null, correct_answer, explanation || null,
       difficulty, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update question' });
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
  listQuestions, getQuestion, createQuestion, updateQuestion, exportBank,
  generateAnswer, deleteQuestion, restoreQuestion,
};

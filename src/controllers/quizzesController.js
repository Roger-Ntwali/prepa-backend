const pool = require('../config/db');
const { toAppShape } = require('../utils/questionShape');

async function createQuiz(req, res) {
  const { title, topic_id, is_adaptive, question_ids } = req.body;
  if (!title || !Array.isArray(question_ids) || !question_ids.length) {
    return res.status(400).json({ error: 'title and a non-empty question_ids array are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO quizzes (title, topic_id, is_adaptive, created_by)
       VALUES ($1,$2,COALESCE($3,false),$4) RETURNING *`,
      [title, topic_id || null, is_adaptive, req.user.id]
    );
    const quiz = rows[0];

    for (let i = 0; i < question_ids.length; i++) {
      await client.query(
        `INSERT INTO quiz_questions (quiz_id, question_id, order_index) VALUES ($1,$2,$3)`,
        [quiz.id, question_ids[i], i]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(quiz);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create quiz' });
  } finally {
    client.release();
  }
}

// Lets students browse quizzes a teacher has put together (title +
// which topic it covers + how many questions) before opening one.
// Adaptive/auto-generated sets aren't listed here since they're
// requested on demand, not browsed.
async function listQuizzes(req, res) {
  const { rows } = await pool.query(
    `SELECT z.id, z.title, z.topic_id, t.title AS topic_title, z.created_at,
            COUNT(qq.question_id)::int AS question_count
     FROM quizzes z
     LEFT JOIN topics t ON t.id = z.topic_id
     LEFT JOIN quiz_questions qq ON qq.quiz_id = z.id
     WHERE z.is_adaptive = false
     GROUP BY z.id, t.title
     ORDER BY z.created_at DESC`
  );
  res.json(rows);
}

async function getQuiz(req, res) {
  const { id } = req.params;
  const quizRes = await pool.query('SELECT * FROM quizzes WHERE id = $1', [id]);
  if (!quizRes.rows.length) return res.status(404).json({ error: 'Quiz not found' });

  const questionsRes = await pool.query(
    `SELECT q.*, qq.order_index FROM quiz_questions qq
     JOIN questions q ON q.id = qq.question_id
     WHERE qq.quiz_id = $1 ORDER BY qq.order_index ASC`,
    [id]
  );
  res.json({ ...quizRes.rows[0], questions: questionsRes.rows.map(toAppShape) });
}

// Adaptive practice: pick questions weighted toward topics/difficulties
// where the student has previously answered incorrectly.
async function adaptiveSet(req, res) {
  const studentId = req.user.id;
  // Accept either an explicit `limit`, or `duration_minutes` so a timed
  // quiz request scales its question count to fit the time available —
  // same formula used by the app's Exam Simulation (roughly 5 min -> 20
  // questions, 15 min -> 50 questions).
  let limit = parseInt(req.query.limit, 10) || 10;
  const durationMinutes = parseInt(req.query.duration_minutes, 10);
  if (durationMinutes) {
    limit = Math.min(150, Math.max(5, 5 + durationMinutes * 3));
  }

  const { rows: weakTopics } = await pool.query(
    `SELECT q.topic_id, COUNT(*) AS misses
     FROM attempt_answers aa
     JOIN questions q ON q.id = aa.question_id
     JOIN quiz_attempts a ON a.id = aa.attempt_id
     WHERE a.student_id = $1 AND aa.is_correct = false
     GROUP BY q.topic_id
     ORDER BY misses DESC
     LIMIT 3`,
    [studentId]
  );

  let questions;
  if (weakTopics.length) {
    const topicIds = weakTopics.map(r => r.topic_id);
    const { rows } = await pool.query(
      `SELECT * FROM questions WHERE topic_id = ANY($1::uuid[])
       ORDER BY random() LIMIT $2`,
      [topicIds, limit]
    );
    questions = rows;
  } else {
    const { rows } = await pool.query(
      `SELECT * FROM questions ORDER BY random() LIMIT $1`,
      [limit]
    );
    questions = rows;
  }
  res.json({ generated_at: new Date().toISOString(), questions: questions.map(toAppShape) });
}

module.exports = { createQuiz, getQuiz, adaptiveSet, listQuizzes };

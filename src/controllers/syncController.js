// The Flutter app is offline-first: on login it calls GET /sync/pull once
// to seed its entire local database (topics, questions, quizzes, and
// crucially past_papers) before showing any content screen. This endpoint
// didn't exist before — meaning past papers (and everything else) never
// actually reached the app outside of its built-in demo/offline data.
//
// The app has no concept of multiple subjects on the backend side (this
// is a single-subject Biology app), so every topic/quiz/past_paper is
// tagged with one synthetic subject id the app can key off of.
const pool = require('../config/db');
const { toAppShape } = require('../utils/questionShape');

const SUBJECT_ID = 'biology-subject';

async function fetchAllTables() {
  return Promise.all([
    pool.query('SELECT * FROM topics ORDER BY order_index ASC'),
    pool.query('SELECT * FROM questions'),
    pool.query('SELECT * FROM quizzes WHERE is_adaptive = false'),
    pool.query('SELECT * FROM quiz_questions'),
    pool.query('SELECT * FROM past_papers'),
  ]);
}

async function pull(req, res) {
  let topicsRes, questionsRes, quizzesRes, quizQuestionsRes, papersRes;
  try {
    // Neon's pooled connections occasionally drop mid-query (ECONNRESET);
    // since this is a pure read, one retry is safe and clears up almost
    // every transient case without the caller needing to know.
    [topicsRes, questionsRes, quizzesRes, quizQuestionsRes, papersRes] = await fetchAllTables();
  } catch (firstErr) {
    console.error('sync/pull first attempt failed, retrying once:', firstErr.message);
    try {
      [topicsRes, questionsRes, quizzesRes, quizQuestionsRes, papersRes] = await fetchAllTables();
    } catch (secondErr) {
      console.error('sync/pull failed after retry:', secondErr);
      return res.status(503).json({ error: 'Sync temporarily unavailable — please try again.' });
    }
  }

  const deltas = {
    subjects: [
      {
        id: SUBJECT_ID,
        name: 'Biology',
        level: 'O-Level',
        description: 'REB O-Level Biology and Health Sciences curriculum.',
      },
    ],
    topics: topicsRes.rows.map((t) => ({
      id: t.id,
      subject_id: SUBJECT_ID,
      name: t.title,
      description: t.description,
      order: t.order_index,
    })),
    questions: questionsRes.rows.map(toAppShape),
    quizzes: quizzesRes.rows.map((q) => ({
      id: q.id,
      subject_id: SUBJECT_ID,
      title: q.title,
      type: 'practice',
      created_at: q.created_at,
    })),
    quiz_questions: quizQuestionsRes.rows.map((qq) => ({
      // quiz_questions has no standalone id column (composite PK), so
      // synthesize a stable one from its two foreign keys.
      id: `${qq.quiz_id}-${qq.question_id}`,
      quiz_id: qq.quiz_id,
      question_id: qq.question_id,
      order: qq.order_index,
    })),
    past_papers: papersRes.rows.map((p) => ({
      id: p.id,
      subject_id: SUBJECT_ID,
      title: p.title,
      year: p.year,
      file_url: p.file_url,
    })),
  };

  res.json({ deltas, server_timestamp: new Date().toISOString() });
}

// Attempts already sync through the dedicated /attempts/sync endpoint, so
// this is a harmless no-op — it just means the app's push-then-pull cycle
// never fails on this half of the round trip.
async function push(req, res) {
  const attempts = req.body?.attempts;
  res.json({ ok: true, received: Array.isArray(attempts) ? attempts.length : 0 });
}

module.exports = { pull, push };

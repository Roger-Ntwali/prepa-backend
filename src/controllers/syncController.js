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
    pool.query('SELECT * FROM questions WHERE archived_at IS NULL'),
    pool.query('SELECT * FROM quizzes WHERE is_adaptive = false AND archived_at IS NULL'),
    pool.query('SELECT * FROM quiz_questions'),
    pool.query('SELECT * FROM past_papers WHERE archived_at IS NULL'),
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

// The mobile app's SyncService calls this, not /attempts/sync -- Attempt
// records are one answered question each (see lib/models/attempt.dart's
// toPushJson: id, question_id, quiz_id?, student_answer, is_correct,
// time_spent_seconds?, attempted_at), not a nested quiz-session shape.
// This used to be a no-op stub, meaning every attempt the shipped app
// ever pushed was silently discarded -- reports/class-summary and every
// student's recent-attempts history were built on zero real data.
//
// attempt_answers.attempt_id is required by the existing reports (they
// INNER JOIN through quiz_attempts to get topic/quiz context), so pushed
// answers are grouped by quiz_id and each group becomes one quiz_attempts
// "sitting" -- the closest thing to a session boundary this client shape
// has, since it sends no separate session id of its own.
async function push(req, res) {
  const studentId = req.user.id;
  const deviceId = req.body?.device_id || null;
  const attempts = req.body?.attempts;

  if (!Array.isArray(attempts) || !attempts.length) {
    return res.json({ ok: true, received: 0, persisted: 0 });
  }

  const groups = new Map();
  for (const a of attempts) {
    if (!a || !a.question_id) continue; // can't record an answer with no question
    const key = a.quiz_id || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }

  const client = await pool.connect();
  let persisted = 0;
  try {
    await client.query('BEGIN');

    for (const [key, group] of groups) {
      const quizId = key || null;
      const times = group.map((a) => a.attempted_at).filter(Boolean).sort();
      const startedAt = times[0] || null;
      const completedAt = times[times.length - 1] || null;

      const { rows: attemptRows } = await client.query(
        `INSERT INTO quiz_attempts (quiz_id, student_id, device_id, started_at, completed_at, synced_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id`,
        [quizId, studentId, deviceId, startedAt, completedAt]
      );
      const attemptRowId = attemptRows[0].id;

      let insertedInGroup = 0;
      for (const a of group) {
        const { rowCount } = await client.query(
          `INSERT INTO attempt_answers (id, attempt_id, question_id, selected_answer, is_correct, time_spent_seconds, created_at)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, COALESCE($7, now()))
           ON CONFLICT (id) DO NOTHING`,
          [
            a.id || null,
            attemptRowId,
            a.question_id,
            a.student_answer || null,
            a.is_correct ?? null,
            a.time_spent_seconds || null,
            a.attempted_at || null,
          ]
        );
        insertedInGroup += rowCount;
      }

      if (insertedInGroup === 0) {
        // Every answer in this group was already stored by an earlier,
        // successful push that never got acknowledged back to the client
        // -- this "sitting" carries no new data, so drop it rather than
        // double-count a session that produced nothing new.
        await client.query('DELETE FROM quiz_attempts WHERE id = $1', [attemptRowId]);
        continue;
      }

      const correct = group.filter((a) => a.is_correct).length;
      const score = Math.round((correct / group.length) * 100);
      await client.query('UPDATE quiz_attempts SET score = $1 WHERE id = $2', [score, attemptRowId]);
      persisted += insertedInGroup;
    }

    await client.query(
      `INSERT INTO sync_log (user_id, device_id, sync_type, status) VALUES ($1,$2,'quiz_attempts','success')`,
      [studentId, deviceId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, received: attempts.length, persisted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('sync/push failed:', err);
    res.status(500).json({ error: 'Sync failed' });
  } finally {
    client.release();
  }
}

module.exports = { pull, push };

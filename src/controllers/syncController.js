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

// `since` (a Date, or null for a full pull) filters every table on
// updated_at -- populated by a trigger on each table, see migration
// 003_delta_sync.sql. Archived rows still just drop out of the result
// entirely rather than being flagged for client-side removal: the app
// does a full pull once at every login anyway (initialFullSync), so a
// row archived between two delta pulls self-corrects on next login.
// True tombstone propagation (telling an already-synced client to
// remove something mid-session) is a larger feature, deliberately not
// built here.
async function fetchAllTables(since) {
  const topicsSql = since
    ? 'SELECT * FROM topics WHERE updated_at > $1 ORDER BY order_index ASC'
    : 'SELECT * FROM topics ORDER BY order_index ASC';
  const questionsSql = since
    ? 'SELECT * FROM questions WHERE archived_at IS NULL AND updated_at > $1'
    : 'SELECT * FROM questions WHERE archived_at IS NULL';
  const quizzesSql = since
    ? 'SELECT * FROM quizzes WHERE is_adaptive = false AND archived_at IS NULL AND updated_at > $1'
    : 'SELECT * FROM quizzes WHERE is_adaptive = false AND archived_at IS NULL';
  const quizQuestionsSql = since
    ? 'SELECT * FROM quiz_questions WHERE updated_at > $1'
    : 'SELECT * FROM quiz_questions';
  const papersSql = since
    ? 'SELECT * FROM past_papers WHERE archived_at IS NULL AND updated_at > $1'
    : 'SELECT * FROM past_papers WHERE archived_at IS NULL';

  const params = since ? [since] : [];
  return Promise.all([
    pool.query(topicsSql, params),
    pool.query(questionsSql, params),
    pool.query(quizzesSql, params),
    pool.query(quizQuestionsSql, params),
    pool.query(papersSql, params),
  ]);
}

async function pull(req, res) {
  const rawSince = req.query.last_sync;
  let since = null;
  if (rawSince) {
    const parsed = new Date(rawSince);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'last_sync must be a valid timestamp' });
    }
    since = parsed;
  }

  let topicsRes, questionsRes, quizzesRes, quizQuestionsRes, papersRes;
  try {
    // Neon's pooled connections occasionally drop mid-query (ECONNRESET);
    // since this is a pure read, one retry is safe and clears up almost
    // every transient case without the caller needing to know.
    [topicsRes, questionsRes, quizzesRes, quizQuestionsRes, papersRes] = await fetchAllTables(since);
  } catch (firstErr) {
    console.error('sync/pull first attempt failed, retrying once:', firstErr.message);
    try {
      [topicsRes, questionsRes, quizzesRes, quizQuestionsRes, papersRes] = await fetchAllTables(since);
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
// toPushJson: id, question_id, quiz_id?, session_id, student_answer,
// is_correct, time_spent_seconds?, attempted_at, forfeited), not a nested
// quiz-session shape. This used to be a no-op stub, meaning every attempt
// the shipped app ever pushed was silently discarded -- reports/class-summary
// and every student's recent-attempts history were built on zero real data.
//
// attempt_answers.attempt_id is required by the existing reports (they
// INNER JOIN through quiz_attempts to get topic/quiz context), so pushed
// answers are grouped into one quiz_attempts "sitting" per session_id --
// the real, mode-agnostic session boundary the app generates once per
// quiz-taking screen instance (practice included). Older app builds that
// predate session_id fall back to grouping by quiz_id, matching the
// original behavior for anyone who hasn't updated yet.
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
    const key = a.session_id || a.quiz_id || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }

  const client = await pool.connect();
  let persisted = 0;
  try {
    await client.query('BEGIN');

    for (const [key, group] of groups) {
      // quiz_id is a real per-answer field (null for practice mode);
      // `key` is the grouping key, which is session_id for anything sent
      // by an app build that has it, or quiz_id itself on the old fallback
      // path -- either way it's what quiz_attempts.session_id records.
      const quizId = group.find((a) => a.quiz_id)?.quiz_id || null;
      const times = group.map((a) => a.attempted_at).filter(Boolean).sort();
      const startedAt = times[0] || null;
      const completedAt = times[times.length - 1] || null;

      // A session split across two pushes (e.g. synced mid-quiz, then
      // again after finishing) must resolve to the SAME quiz_attempts row,
      // not a second one -- otherwise re-syncing a partially-uploaded
      // session, or the forfeit-flag arriving in a later push than the
      // answers it applies to, would double-count or silently miss it.
      let attemptRowId;
      let isExistingRow = false;
      if (key) {
        const { rows: existingRows } = await client.query(
          'SELECT id FROM quiz_attempts WHERE student_id = $1 AND session_id = $2',
          [studentId, key]
        );
        if (existingRows.length) {
          attemptRowId = existingRows[0].id;
          isExistingRow = true;
          await client.query(
            `UPDATE quiz_attempts SET
               started_at = LEAST(started_at, $1::timestamptz),
               completed_at = GREATEST(completed_at, $2::timestamptz),
               synced_at = now()
             WHERE id = $3`,
            [startedAt, completedAt, attemptRowId]
          );
        }
      }
      if (!isExistingRow) {
        const { rows: attemptRows } = await client.query(
          `INSERT INTO quiz_attempts (quiz_id, student_id, device_id, session_id, started_at, completed_at, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           RETURNING id`,
          [quizId, studentId, deviceId, key || null, startedAt, completedAt]
        );
        attemptRowId = attemptRows[0].id;
      }

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

      if (!isExistingRow && insertedInGroup === 0) {
        // Every answer in this group was already stored by an earlier,
        // successful push that never got acknowledged back to the client
        // -- this "sitting" carries no new data, so drop it rather than
        // double-count a session that produced nothing new.
        await client.query('DELETE FROM quiz_attempts WHERE id = $1', [attemptRowId]);
        continue;
      }

      // A forfeited session (student left the quiz screen or backgrounded
      // the app mid-quiz, per the mobile app's own leave-detection) scores
      // 0 regardless of what was answered -- individual attempt_answers
      // rows above still keep each real is_correct value, since per-topic
      // reporting should reflect actual understanding even when the
      // session's graded score was zeroed for leaving. Score is recomputed
      // from every answer on this attempt (not just this batch) so a
      // session synced across multiple pushes still ends up with its true
      // total, and "forfeited" is sticky -- once set, a later batch that
      // doesn't repeat the flag can't un-forfeit it.
      const forfeitedThisBatch = group.some((a) => a.forfeited === true);
      const { rows: allAnswers } = await client.query(
        'SELECT is_correct FROM attempt_answers WHERE attempt_id = $1',
        [attemptRowId]
      );
      const correct = allAnswers.filter((r) => r.is_correct).length;
      const score = allAnswers.length ? Math.round((correct / allAnswers.length) * 100) : 0;
      await client.query(
        `UPDATE quiz_attempts SET
           score = CASE WHEN status = 'forfeited' OR $1 THEN 0 ELSE $2 END,
           status = CASE WHEN status = 'forfeited' OR $1 THEN 'forfeited' ELSE 'completed' END
         WHERE id = $3`,
        [forfeitedThisBatch, score, attemptRowId]
      );
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

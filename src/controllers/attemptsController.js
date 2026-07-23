const pool = require('../config/db');

// The mobile app records attempts locally (SQLite) while offline, then
// POSTs a batch here once connectivity returns. Each attempt carries its
// own client-generated id so re-sends are safe (idempotent upsert).
async function syncAttempts(req, res) {
  const studentId = req.user.id;
  const { device_id, attempts } = req.body;

  if (!Array.isArray(attempts) || !attempts.length) {
    return res.status(400).json({ error: 'attempts must be a non-empty array' });
  }

  const client = await pool.connect();
  const results = [];
  try {
    await client.query('BEGIN');

    for (const att of attempts) {
      const { id, quiz_id, started_at, completed_at, score, answers } = att;

      const { rows } = await client.query(
        `INSERT INTO quiz_attempts (id, quiz_id, student_id, device_id, started_at, completed_at, score, synced_at)
         VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (id) DO UPDATE SET synced_at = now()
         RETURNING id`,
        [id || null, quiz_id || null, studentId, device_id || null, started_at || null, completed_at || null, score || null]
      );
      const attemptId = rows[0].id;

      if (Array.isArray(answers)) {
        for (const ans of answers) {
          await client.query(
            `INSERT INTO attempt_answers (attempt_id, question_id, selected_answer, is_correct, time_spent_seconds)
             VALUES ($1,$2,$3,$4,$5)`,
            [attemptId, ans.question_id, ans.selected_answer || null, ans.is_correct ?? null, ans.time_spent_seconds || null]
          );
        }
      }
      results.push(attemptId);
    }

    await client.query(
      `INSERT INTO sync_log (user_id, device_id, sync_type, status) VALUES ($1,$2,'quiz_attempts','success')`,
      [studentId, device_id || null]
    );

    await client.query('COMMIT');
    res.json({ synced: results.length, attempt_ids: results });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Sync failed' });
  } finally {
    client.release();
  }
}

async function myAttempts(req, res) {
  const { rows } = await pool.query(
    `SELECT * FROM quiz_attempts WHERE student_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}

module.exports = { syncAttempts, myAttempts };

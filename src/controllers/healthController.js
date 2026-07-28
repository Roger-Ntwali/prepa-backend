const pool = require('../config/db');

// Unlike GET /health (a pure liveness check), this actually queries Postgres
// so a misconfigured DATABASE_URL or an empty/wrong database shows up here
// instead of silently surfacing as "0 students" three clicks deep in the
// portal UI.
async function checkDb(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        current_database() AS database,
        (SELECT COUNT(*) FROM users WHERE role = 'student')::int AS students,
        (SELECT COUNT(*) FROM questions WHERE archived_at IS NULL)::int AS questions,
        (SELECT COUNT(*) FROM topics)::int AS topics
    `);
    res.json({ status: 'ok', ...rows[0] });
  } catch (err) {
    console.error('Health check: database unreachable', err);
    res.status(503).json({ status: 'error', message: err.message });
  }
}

module.exports = { checkDb };

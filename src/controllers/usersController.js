const pool = require('../config/db');

// Teachers awaiting approval (registered but is_active = false).
async function listPendingTeachers(req, res) {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, username, created_at
     FROM users WHERE role = 'teacher' AND is_active = false
     ORDER BY created_at ASC`
  );
  res.json({ pending: rows });
}

async function approveTeacher(req, res) {
  const { rows } = await pool.query(
    `UPDATE users SET is_active = true
     WHERE id = $1 AND role = 'teacher'
     RETURNING id, full_name, email, username, is_active`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Teacher not found' });
  res.json({ user: rows[0] });
}

// Reject = permanently remove the pending account so they can re-register
// cleanly if it was a mistake.
async function rejectTeacher(req, res) {
  const { rows } = await pool.query(
    `DELETE FROM users WHERE id = $1 AND role = 'teacher' AND is_active = false RETURNING id`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Pending teacher not found' });
  res.json({ ok: true });
}

// All students, with a quick performance snapshot for the admin/teacher
// dashboard's overview list.
async function listStudents(req, res) {
  const { rows } = await pool.query(`
    SELECT
      u.id, u.full_name, u.username, u.class_level,
      COUNT(DISTINCT qa.id)::int AS attempts_count,
      ROUND(AVG(qa.score)::numeric, 1) AS avg_score,
      MAX(qa.completed_at) AS last_active
    FROM users u
    LEFT JOIN quiz_attempts qa ON qa.student_id = u.id AND qa.completed_at IS NOT NULL
    WHERE u.role = 'student'
    GROUP BY u.id
    ORDER BY u.full_name ASC
  `);
  res.json({ students: rows });
}

module.exports = { listPendingTeachers, approveTeacher, rejectTeacher, listStudents };

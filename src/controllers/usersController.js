const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { parsePageLimit } = require('../utils/pagination');

// Teachers awaiting approval (registered but is_active = false).
async function listPendingTeachers(req, res) {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, username, created_at
     FROM users WHERE role = 'teacher' AND is_active = false
     ORDER BY created_at ASC`
  );
  res.json({ pending: rows });
}

// Every teacher, active or pending, for the admin's Teachers management
// screen. Pending ones surface first -- they're the ones needing action.
async function listTeachers(req, res) {
  const { page, limit, offset } = parsePageLimit(req);
  const { rows } = await pool.query(
    `SELECT id, full_name, email, username, is_active, created_at,
            COUNT(*) OVER()::int AS total_count
     FROM users WHERE role = 'teacher'
     ORDER BY is_active ASC, created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const total = rows[0]?.total_count ?? 0;
  res.json({
    teachers: rows.map(({ total_count, ...r }) => r),
    total, page, limit,
  });
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

// Generates a one-time 6-digit code the admin reads out (or otherwise
// relays) to the teacher, who exchanges it -- along with their email and a
// new password -- at POST /auth/reset-password. crypto.randomInt is used
// rather than Math.random() since this gates account access, however
// short-lived the code is. Scoped to role='teacher': this is teacher
// account management, not a general admin password reset for any user.
async function resetTeacherPassword(req, res) {
  const code = crypto.randomInt(100000, 1000000).toString();
  const { rows } = await pool.query(
    `UPDATE users
     SET reset_code = $1, reset_code_expires_at = now() + interval '15 minutes'
     WHERE id = $2 AND role = 'teacher'
     RETURNING id, full_name, email`,
    [code, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Teacher not found' });
  res.json({ code, expires_in_minutes: 15, teacher: rows[0] });
}

// All students, with a quick performance snapshot for the admin/teacher
// dashboard's overview list. Archived (soft-deleted) students are excluded,
// same as archived questions never appear in the bank.
async function listStudents(req, res) {
  const { page, limit, offset } = parsePageLimit(req);
  const { search, class_level, active } = req.query;
  const params = [limit, offset];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    searchClause = `AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
  }
  let classClause = '';
  if (class_level) {
    params.push(class_level);
    classClause = `AND u.class_level = $${params.length}`;
  }
  // "Active" / "Never" reflect last_active, which is an aggregate
  // (MAX(qa.completed_at)) -- filtering on it belongs in HAVING, not WHERE.
  let havingClause = '';
  if (active === 'active') havingClause = 'HAVING MAX(qa.completed_at) IS NOT NULL';
  else if (active === 'never') havingClause = 'HAVING MAX(qa.completed_at) IS NULL';

  // The class-dropdown query is independent of this request's own
  // filters/pagination, so it runs alongside the main query instead of
  // after it -- two sequential round-trips to a remote Neon connection
  // measurably adds up versus one.
  const [{ rows }, { rows: classRows }] = await Promise.all([
    pool.query(`
      SELECT
        u.id, u.full_name, u.email, u.class_level,
        COUNT(DISTINCT qa.id)::int AS attempts_count,
        ROUND(AVG(qa.score)::numeric, 1) AS avg_score,
        MAX(qa.completed_at) AS last_active,
        COUNT(*) OVER()::int AS total_count
      FROM users u
      LEFT JOIN quiz_attempts qa ON qa.student_id = u.id AND qa.completed_at IS NOT NULL
      WHERE u.role = 'student' AND u.archived_at IS NULL
      ${searchClause} ${classClause}
      GROUP BY u.id
      ${havingClause}
      ORDER BY u.full_name ASC
      LIMIT $1 OFFSET $2
    `, params),
    // Powers the class filter dropdown -- computed fresh each call (cheap,
    // small table) rather than kept in sync some other way.
    pool.query(
      `SELECT DISTINCT class_level FROM users
       WHERE role = 'student' AND archived_at IS NULL AND class_level IS NOT NULL
       ORDER BY class_level`
    ),
  ]);

  const total = rows[0]?.total_count ?? 0;
  res.json({
    students: rows.map(({ total_count, ...r }) => r),
    total, page, limit,
    available_classes: classRows.map((r) => r.class_level),
  });
}

// Admin creates a student account directly (no self-service invite email
// path exists yet). A random temp password is generated and returned once
// -- the admin is expected to relay it to the student, who can change it
// later via the same forgot-password flow any user uses.
async function createStudent(req, res) {
  const { full_name, email, class_level } = req.body;
  const tempPassword = crypto.randomBytes(9).toString('base64url');

  try {
    const password_hash = await bcrypt.hash(tempPassword, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, role, email, password_hash, school_id, class_level, is_active)
       VALUES ($1, 'student', $2, $3, $4, $5, true)
       RETURNING id, full_name, email, class_level, is_active, created_at`,
      [full_name, email, password_hash, req.user.school_id || null, class_level || null]
    );
    res.status(201).json({ user: rows[0], temp_password: tempPassword });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create student' });
  }
}

async function updateStudent(req, res) {
  const { id } = req.params;
  const { full_name, email, class_level } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE users SET full_name = $1, email = $2, class_level = $3
       WHERE id = $4 AND role = 'student'
       RETURNING id, full_name, email, class_level, is_active, created_at`,
      [full_name, email, class_level || null, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to update student' });
  }
}

// Same reasoning as questionsController.deleteQuestion: quiz_attempts.student_id
// is ON DELETE CASCADE, so hard-deleting a student who has taken quizzes would
// take their whole history with it and silently rewrite class reports. If
// they have attempts, archive instead; otherwise there's nothing to lose.
async function deleteStudent(req, res) {
  const { id } = req.params;

  const existing = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'student'`,
    [id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const answered = await pool.query(
    'SELECT 1 FROM quiz_attempts WHERE student_id = $1 LIMIT 1',
    [id]
  );

  if (answered.rows.length) {
    await pool.query('UPDATE users SET archived_at = now() WHERE id = $1', [id]);
    return res.json({
      id,
      action: 'archived',
      message:
        'This student has quiz history, so the account was archived instead of deleted. They no longer appear in the roster or can sign in, and past results are unchanged.',
    });
  }

  await pool.query(`DELETE FROM users WHERE id = $1 AND role = 'student'`, [id]);
  res.json({ id, action: 'deleted', message: 'Student deleted.' });
}

async function restoreStudent(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE users SET archived_at = NULL WHERE id = $1 AND role = 'student' RETURNING id`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Student not found' });
  res.json({ id, action: 'restored', message: 'Student restored.' });
}

module.exports = {
  listPendingTeachers, listTeachers, approveTeacher, rejectTeacher,
  resetTeacherPassword, listStudents,
  createStudent, updateStudent, deleteStudent, restoreStudent,
};

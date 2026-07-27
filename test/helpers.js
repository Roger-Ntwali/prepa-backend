const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');

// Wipes every table the tests touch, in FK-safe order via CASCADE.
// schema_migrations is left alone -- it's not app data.
async function resetDb() {
  await pool.query(`
    TRUNCATE TABLE
      sync_log, ai_tutor_sessions, attempt_answers, quiz_attempts,
      quiz_questions, quizzes, questions, past_papers, topics, users, schools
    RESTART IDENTITY CASCADE
  `);
}

async function makeUser({ role, fullName, email, username, password, schoolId, isActive = true }) {
  // Cost factor 4, not the real app's 10 -- these hashes only ever need to
  // survive one test run, and bcrypt at 10 rounds adds up across a suite.
  const hash = await bcrypt.hash(password, 4);
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (school_id, role, full_name, email, username, password_hash, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [schoolId, role, fullName, email || null, username || null, hash, isActive]
  );
  const token = jwt.sign(
    { id: user.id, role: user.role, school_id: user.school_id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return { ...user, token, plainPassword: password };
}

// One school, one admin/teacher/student, one topic -- enough for most
// route tests without every file hand-rolling the same setup.
async function seedBasics() {
  const { rows: [school] } = await pool.query(
    `INSERT INTO schools (name, district) VALUES ($1,$2) RETURNING id`,
    ['Test School', 'Test District']
  );

  const admin = await makeUser({ role: 'admin', fullName: 'Test Admin', email: 'admin@test.local', password: 'password123', schoolId: school.id });
  const teacher = await makeUser({ role: 'teacher', fullName: 'Test Teacher', email: 'teacher@test.local', password: 'password123', schoolId: school.id });
  const student = await makeUser({ role: 'student', fullName: 'Test Student', username: 'teststudent', password: 'password123', schoolId: school.id });

  const { rows: [topic] } = await pool.query(
    `INSERT INTO topics (title, description, order_index) VALUES ($1,$2,$3) RETURNING *`,
    ['Test Topic', 'A topic for tests', 1]
  );

  return { school, admin, teacher, student, topic };
}

module.exports = { resetDb, seedBasics, makeUser };

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, school_id: user.school_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function register(req, res) {
  // The app's registration form sends { name, email, password, role, level,
  // school_name }. `full_name`/`class_level` are the real column names;
  // accept both. `school_id` is a real foreign key to the schools table —
  // the app has no way to supply a valid one yet, so school_name (a plain
  // string) is intentionally not mapped to it to avoid a type/FK error.
  const { full_name, name, role, email, username, password, school_id, class_level, level } = req.body;
  const fullName = full_name || name;
  const classLevel = class_level || level;

  if (!fullName || !role || !password || (!email && !username)) {
    return res.status(400).json({ error: 'name, role, password, and email or username are required' });
  }
  if (!['student', 'teacher', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'role must be student, teacher, or admin' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    // Teachers must be approved by an admin before they can log in.
    // Students and admin-created accounts are active immediately.
    const isActive = role !== 'teacher';
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, role, email, username, password_hash, school_id, class_level, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, full_name, role, email, username, school_id, class_level, is_active, created_at`,
      [fullName, role, email || null, username || null, password_hash, school_id || null, classLevel || null, isActive]
    );
    const user = rows[0];
    if (!user.is_active) {
      // Pending approval — no token yet, since they can't log in until approved.
      return res.status(201).json({ user, pending_approval: true });
    }
    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email or username already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
}

async function login(req, res) {
  // The app's login form sends { email, password }; some clients (and the
  // register flow) use { identifier, password } where identifier can be
  // an email or a username. Accept either so both work.
  const { identifier, email, password } = req.body;
  const loginId = identifier || email;
  if (!loginId || !password) {
    return res.status(400).json({ error: 'email (or identifier) and password are required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE (email = $1 OR username = $1)`,
      [loginId]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.is_active) {
      return res.status(403).json({ error: 'Your teacher account is awaiting admin approval.' });
    }

    const token = signToken(user);
    delete user.password_hash;
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
}

module.exports = { register, login };

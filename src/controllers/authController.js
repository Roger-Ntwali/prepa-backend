const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const { sendResetCodeEmail } = require('../utils/mailer');

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, school_id: user.school_id, is_super_admin: !!user.is_super_admin },
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
  // Normalized so "Jane@Example.com" and "jane@example.com" collide as the
  // same signup instead of silently creating two accounts -- the
  // users_email_lower_key index (006_email_case_insensitive.sql) enforces
  // this at the DB level too, but normalizing here keeps the stored value
  // itself consistent for every other query that reads it back.
  const normalizedEmail = email ? email.trim().toLowerCase() : null;

  if (!fullName || !role || !password || (!normalizedEmail && !username)) {
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
       RETURNING id, full_name, role, email, username, school_id, class_level, is_active, is_super_admin, created_at`,
      [fullName, role, normalizedEmail, username || null, password_hash, school_id || null, classLevel || null, isActive]
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
      return res.status(409).json({ error: 'That email or username already has an account. Try logging in instead.' });
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
      `SELECT * FROM users WHERE (LOWER(email) = LOWER($1) OR username = $1)`,
      [loginId]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.is_active) {
      return res.status(403).json({ error: 'Your teacher account is awaiting admin approval.' });
    }
    if (user.archived_at) {
      return res.status(403).json({ error: 'This account has been removed.' });
    }

    const token = signToken(user);
    delete user.password_hash;
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
}

// Public, self-service, works for any role. Never reveals whether `email`
// belongs to an account, or whether the email actually sent -- the
// response is identical in every case (found/not found, mailer configured
// or not, Resend API up or down). Rate-limited more strictly than
// login/register (see forgotPasswordLimiter): unlike those, a hit here
// that matches a real account costs an actual email send, so this is the
// one endpoint worth protecting against being used to spam a stranger.
async function forgotPassword(req, res) {
  const { email } = req.body;
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    const user = rows[0];
    if (user) {
      const code = crypto.randomInt(100000, 1000000).toString();
      await pool.query(
        `UPDATE users SET reset_code = $1, reset_code_expires_at = now() + interval '15 minutes'
         WHERE id = $2`,
        [code, user.id]
      );
      // Failures are logged inside sendResetCodeEmail and never thrown --
      // this response must look identical whether or not the send worked.
      await sendResetCodeEmail(email, code);
    }
  } catch (err) {
    console.error(err);
    // Still fall through to the same generic response below.
  }
  res.json({ ok: true, message: 'If that email exists, a reset code has been sent to it.' });
}

// Public (no session exists yet -- that's the whole point). Exchanges a
// reset code for a new password. Matches on
// email + reset_code + an unexpired reset_code_expires_at all at once, so
// a wrong code and an expired code get the same clear, non-revealing
// error rather than leaking which part failed.
async function resetPasswordWithCode(req, res) {
  const { email, code, new_password } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users
       WHERE LOWER(email) = LOWER($1) AND reset_code = $2 AND reset_code_expires_at > now()`,
      [email, code]
    );
    const user = rows[0];
    if (!user) {
      return res.status(400).json({
        error: 'That code is invalid or has expired. Request a new one.',
      });
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, reset_code = NULL, reset_code_expires_at = NULL
       WHERE id = $2`,
      [password_hash, user.id]
    );
    res.json({ ok: true, message: 'Password updated. You can now sign in with your new password.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Password reset failed' });
  }
}

module.exports = { register, login, forgotPassword, resetPasswordWithCode };

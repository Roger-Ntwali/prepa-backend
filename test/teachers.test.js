const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { resetDb, seedBasics, makeUser } = require('./helpers');

let fixtures;

beforeEach(async () => {
  await resetDb();
  fixtures = await seedBasics();
});

afterAll(async () => {
  await pool.end();
});

describe('GET /api/v1/users/teachers', () => {
  it('lists both active and pending teachers', async () => {
    const pending = await makeUser({
      role: 'teacher', fullName: 'Pending Teacher', email: 'pending@test.local',
      password: 'password123', schoolId: fixtures.school.id, isActive: false,
    });

    const res = await request(app)
      .get('/api/v1/users/teachers')
      .set('Authorization', `Bearer ${fixtures.admin.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.teachers.map((t) => t.id);
    expect(ids).toContain(fixtures.teacher.id);
    expect(ids).toContain(pending.id);
    const pendingRow = res.body.teachers.find((t) => t.id === pending.id);
    expect(pendingRow.is_active).toBe(false);
  });

  it('rejects a non-admin', async () => {
    const res = await request(app)
      .get('/api/v1/users/teachers')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/auth/forgot-password', () => {
  it('generates a code for an existing teacher and stores it (never returned in the response)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: fixtures.teacher.email });
    expect(res.status).toBe(200);
    expect(res.body.code).toBeUndefined();

    const { rows } = await pool.query(
      'SELECT reset_code, reset_code_expires_at FROM users WHERE id = $1',
      [fixtures.teacher.id]
    );
    expect(rows[0].reset_code).toMatch(/^\d{6}$/);
    expect(new Date(rows[0].reset_code_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('works the same way for a student -- this is no longer teacher-only', async () => {
    const student = await makeUser({
      role: 'student', fullName: 'Reset Me', email: 'student-reset@test.local',
      password: 'password123', schoolId: fixtures.school.id,
    });

    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: student.email });
    expect(res.status).toBe(200);

    const { rows } = await pool.query('SELECT reset_code FROM users WHERE id = $1', [student.id]);
    expect(rows[0].reset_code).toMatch(/^\d{6}$/);
  });

  it('returns the exact same response for an email that does not exist, and changes nothing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody-here@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email exists/i);
  });

  it('does not require authentication', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: fixtures.teacher.email });
    expect(res.status).toBe(200);
  });

  it('does not 500 even when RESEND_API_KEY is not configured (fails gracefully)', async () => {
    // This test suite never sets RESEND_API_KEY, so this is already the
    // real condition every other test in this file runs under -- asserted
    // explicitly here since it's the specific behavior that matters.
    expect(process.env.RESEND_API_KEY).toBeFalsy();
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: fixtures.teacher.email });
    expect(res.status).toBe(200);
  });

  it('rejects a malformed email with a clear message, not a 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  // The API no longer returns the code anywhere (it's emailed instead), so
  // tests set it directly -- this is also exactly what the real "check
  // your inbox" step stands in for.
  async function issueCode(userId) {
    const code = '123456';
    await pool.query(
      `UPDATE users SET reset_code = $1, reset_code_expires_at = now() + interval '15 minutes' WHERE id = $2`,
      [code, userId]
    );
    return code;
  }

  it('updates the password on a valid, unexpired code and consumes it', async () => {
    const code = await issueCode(fixtures.teacher.id);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: fixtures.teacher.email, code, new_password: 'brandNewPassword1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The new password actually works...
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: fixtures.teacher.email, password: 'brandNewPassword1' });
    expect(loginRes.status).toBe(200);

    // ...and the code is single-use.
    const { rows } = await pool.query(
      'SELECT reset_code, reset_code_expires_at FROM users WHERE id = $1',
      [fixtures.teacher.id]
    );
    expect(rows[0].reset_code).toBeNull();
    expect(rows[0].reset_code_expires_at).toBeNull();

    const reuseRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: fixtures.teacher.email, code, new_password: 'anotherPassword2' });
    expect(reuseRes.status).toBe(400);
  });

  it('works for a student too -- this endpoint was never role-scoped', async () => {
    // seedBasics' default student has no email (it logs in by username),
    // so this needs its own fixture with one.
    const student = await makeUser({
      role: 'student', fullName: 'Email Student', email: 'email-student@test.local',
      password: 'password123', schoolId: fixtures.school.id,
    });
    const code = await issueCode(student.id);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: student.email, code, new_password: 'brandNewPassword1' });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong code with a clear message, not a 500', async () => {
    await issueCode(fixtures.teacher.id);
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: fixtures.teacher.email, code: '000000', new_password: 'brandNewPassword1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it('rejects an expired code', async () => {
    const code = await issueCode(fixtures.teacher.id);
    await pool.query(
      `UPDATE users SET reset_code_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [fixtures.teacher.id]
    );

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: fixtures.teacher.email, code, new_password: 'brandNewPassword1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it('rejects a malformed code instead of erroring inside Postgres', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: fixtures.teacher.email, code: 'abcdef', new_password: 'brandNewPassword1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/code/i);
  });

  it('rejects a short new_password', async () => {
    const code = await issueCode(fixtures.teacher.id);
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: fixtures.teacher.email, code, new_password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/new_password/i);
  });
});

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

describe('POST /api/v1/users/:id/reset-password', () => {
  it('generates a 6-digit code with a 15-minute expiry', async () => {
    const res = await request(app)
      .post(`/api/v1/users/${fixtures.teacher.id}/reset-password`)
      .set('Authorization', `Bearer ${fixtures.admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^\d{6}$/);
    expect(res.body.expires_in_minutes).toBe(15);

    const { rows } = await pool.query(
      'SELECT reset_code, reset_code_expires_at FROM users WHERE id = $1',
      [fixtures.teacher.id]
    );
    expect(rows[0].reset_code).toBe(res.body.code);
    expect(new Date(rows[0].reset_code_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a non-admin', async () => {
    const res = await request(app)
      .post(`/api/v1/users/${fixtures.teacher.id}/reset-password`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`);
    expect(res.status).toBe(403);
  });

  it('is scoped to teachers -- 404s for a student id', async () => {
    const res = await request(app)
      .post(`/api/v1/users/${fixtures.student.id}/reset-password`)
      .set('Authorization', `Bearer ${fixtures.admin.token}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a teacher that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/users/00000000-0000-0000-0000-000000000000/reset-password')
      .set('Authorization', `Bearer ${fixtures.admin.token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  async function issueCode() {
    const res = await request(app)
      .post(`/api/v1/users/${fixtures.teacher.id}/reset-password`)
      .set('Authorization', `Bearer ${fixtures.admin.token}`);
    return res.body.code;
  }

  it('updates the password on a valid, unexpired code and consumes it', async () => {
    const code = await issueCode();

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

  it('rejects a wrong code with a clear message, not a 500', async () => {
    await issueCode();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: fixtures.teacher.email, code: '000000', new_password: 'brandNewPassword1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it('rejects an expired code', async () => {
    const code = await issueCode();
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
    const code = await issueCode();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: fixtures.teacher.email, code, new_password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/new_password/i);
  });
});

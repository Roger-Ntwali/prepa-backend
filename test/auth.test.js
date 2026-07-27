const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { resetDb, seedBasics } = require('./helpers');

let fixtures;

beforeEach(async () => {
  await resetDb();
  fixtures = await seedBasics();
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/v1/auth/register', () => {
  it('rejects a missing role', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ full_name: 'New Person', email: 'new@test.local', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
  });

  it('rejects a malformed email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ full_name: 'New Person', email: 'not-an-email', password: 'password123', role: 'teacher' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('rejects a password under 6 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ full_name: 'New Person', email: 'new2@test.local', password: '123', role: 'teacher' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('registers a teacher as pending approval, with no token issued', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ full_name: 'New Teacher', email: 'newteacher@test.local', password: 'password123', role: 'teacher' });
    expect(res.status).toBe(201);
    expect(res.body.pending_approval).toBe(true);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.is_active).toBe(false);
  });

  it('registers a student as immediately active, with a token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ full_name: 'New Student', username: 'newstudent', password: 'password123', role: 'student' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.is_active).toBe(true);
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ full_name: 'Duplicate', email: 'teacher@test.local', password: 'password123', role: 'teacher' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('rejects the wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'teacher@test.local', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('blocks a teacher whose account is not yet approved', async () => {
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [fixtures.teacher.id]);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'teacher@test.local', password: 'password123' });
    expect(res.status).toBe(403);
  });

  it('logs in successfully with a valid identifier/password, and never returns the hash', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'teacher@test.local', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('accepts a username as the identifier, not just an email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'teststudent', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('student');
  });
});

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { resetDb, seedBasics } = require('./helpers');

let fixtures;
let question;

beforeEach(async () => {
  await resetDb();
  fixtures = await seedBasics();
  const { rows: [q] } = await pool.query(
    `INSERT INTO questions (topic_id, question_text, question_type, options, correct_answer, difficulty, created_by)
     VALUES ($1,'Push test question?','mcq','{"A":"Yes","B":"No"}','A',2,$2) RETURNING *`,
    [fixtures.topic.id, fixtures.teacher.id]
  );
  question = q;
});

afterAll(async () => {
  await pool.end();
});

// This is the endpoint the shipped mobile app actually calls
// (Attempt.toPushJson -> ApiClient.syncPush -> POST /sync/push) -- it used
// to be a no-op stub that discarded every attempt silently.
describe('POST /api/v1/sync/push', () => {
  it('persists a pushed attempt as one quiz_attempts row plus its answer', async () => {
    const clientId = crypto.randomUUID();
    const res = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${fixtures.student.token}`)
      .send({
        attempts: [{
          id: clientId,
          question_id: question.id,
          student_answer: 'Yes',
          is_correct: true,
          time_spent_seconds: 10,
          attempted_at: new Date().toISOString(),
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.persisted).toBe(1);

    const { rows: attempts } = await pool.query(
      'SELECT * FROM quiz_attempts WHERE student_id = $1', [fixtures.student.id]
    );
    expect(attempts.length).toBe(1);
    expect(Number(attempts[0].score)).toBe(100);

    const { rows: answers } = await pool.query(
      'SELECT * FROM attempt_answers WHERE id = $1', [clientId]
    );
    expect(answers.length).toBe(1);
    expect(answers[0].attempt_id).toBe(attempts[0].id);
  });

  it('is idempotent: retrying the exact same push persists 0 new rows and does not duplicate the session', async () => {
    const clientId = crypto.randomUUID();
    const payload = {
      attempts: [{
        id: clientId,
        question_id: question.id,
        student_answer: 'Yes',
        is_correct: true,
        attempted_at: new Date().toISOString(),
      }],
    };

    const first = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${fixtures.student.token}`)
      .send(payload);
    expect(first.body.persisted).toBe(1);

    const retry = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${fixtures.student.token}`)
      .send(payload);
    expect(retry.status).toBe(200);
    expect(retry.body.persisted).toBe(0);

    const { rows } = await pool.query(
      'SELECT * FROM quiz_attempts WHERE student_id = $1', [fixtures.student.id]
    );
    expect(rows.length).toBe(1); // not 2 -- the retry's empty session was cleaned up
  });

  it('makes the pushed data show up in reports/class-summary', async () => {
    await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${fixtures.student.token}`)
      .send({
        attempts: [{
          id: crypto.randomUUID(),
          question_id: question.id,
          student_answer: 'Yes',
          is_correct: true,
          attempted_at: new Date().toISOString(),
        }],
      });

    const res = await request(app)
      .get('/api/v1/reports/class-summary')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.class_average).toBe(100);
    expect(res.body.most_active[0].attempts_count).toBe(1);
  });

  it('treats an empty attempts array as a harmless no-op', async () => {
    const res = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${fixtures.student.token}`)
      .send({ attempts: [] });
    expect(res.status).toBe(200);
    expect(res.body.persisted).toBe(0);
  });
});

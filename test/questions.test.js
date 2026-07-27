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

describe('POST /api/v1/questions', () => {
  it('rejects a missing question_text with a clear message, not a 500', async () => {
    const res = await request(app)
      .post('/api/v1/questions')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ correct_answer: 'Yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/question_text/i);
  });

  // Regression test: COALESCE($4,'mcq') alone throws "column is of type
  // question_type but expression is of type text" when question_type is
  // omitted, and the route had no try/catch -- the request hung forever
  // with no response ever sent. Both are fixed; this locks the fix in.
  it('defaults question_type to mcq when omitted, and responds (does not hang)', async () => {
    const res = await request(app)
      .post('/api/v1/questions')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({
        question_text: 'What is the powerhouse of the cell?',
        correct_answer: 'Mitochondrion',
        topic_id: fixtures.topic.id,
        options: ['Mitochondrion', 'Nucleus'],
      });
    expect(res.status).toBe(201);
    expect(res.body.question_type).toBe('mcq');
  });

  it('rejects a malformed topic_id instead of erroring inside Postgres', async () => {
    const res = await request(app)
      .post('/api/v1/questions')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ question_text: 'Q?', correct_answer: 'A', topic_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/topic_id/i);
  });

  it('rejects a student trying to create a question', async () => {
    const res = await request(app)
      .post('/api/v1/questions')
      .set('Authorization', `Bearer ${fixtures.student.token}`)
      .send({ question_text: 'Q?', correct_answer: 'A' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/v1/questions/:id', () => {
  async function createQuestion() {
    const { rows: [q] } = await pool.query(
      `INSERT INTO questions (topic_id, question_text, question_type, options, correct_answer, difficulty, created_by)
       VALUES ($1,'Delete me?','mcq','{"A":"Option A","B":"Option B"}','A',2,$2) RETURNING *`,
      [fixtures.topic.id, fixtures.teacher.id]
    );
    return q;
  }

  it('hard-deletes a question nobody has answered', async () => {
    const q = await createQuestion();
    const res = await request(app)
      .delete(`/api/v1/questions/${q.id}`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`);
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('deleted');

    const { rows } = await pool.query('SELECT * FROM questions WHERE id = $1', [q.id]);
    expect(rows.length).toBe(0);
  });

  it('archives (not deletes) a question a student has already answered', async () => {
    const q = await createQuestion();
    const { rows: [attempt] } = await pool.query(
      `INSERT INTO quiz_attempts (student_id, completed_at, score) VALUES ($1, now(), 100) RETURNING id`,
      [fixtures.student.id]
    );
    await pool.query(
      `INSERT INTO attempt_answers (attempt_id, question_id, selected_answer, is_correct) VALUES ($1,$2,'A',true)`,
      [attempt.id, q.id]
    );

    const res = await request(app)
      .delete(`/api/v1/questions/${q.id}`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`);
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('archived');

    const { rows } = await pool.query('SELECT archived_at FROM questions WHERE id = $1', [q.id]);
    expect(rows.length).toBe(1);
    expect(rows[0].archived_at).not.toBeNull();

    // The underlying answer must survive -- that's the entire point of
    // archiving instead of a hard delete.
    const { rows: answerRows } = await pool.query('SELECT * FROM attempt_answers WHERE question_id = $1', [q.id]);
    expect(answerRows.length).toBe(1);
  });

  it('returns 404 for a question that does not exist', async () => {
    const res = await request(app)
      .delete('/api/v1/questions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/questions', () => {
  it('excludes archived questions by default', async () => {
    const { rows: [q] } = await pool.query(
      `INSERT INTO questions (topic_id, question_text, question_type, options, correct_answer, difficulty, created_by, archived_at)
       VALUES ($1,'Archived?','mcq','{"A":"Option A","B":"Option B"}','A',2,$2, now()) RETURNING *`,
      [fixtures.topic.id, fixtures.teacher.id]
    );
    const res = await request(app)
      .get('/api/v1/questions')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`);
    expect(res.status).toBe(200);
    expect(res.body.find((r) => r.id === q.id)).toBeUndefined();
  });
});

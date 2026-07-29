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

async function createQuiz(fixtures) {
  const { rows: [q] } = await pool.query(
    `INSERT INTO questions (topic_id, question_text, question_type, options, correct_answer, difficulty, created_by)
     VALUES ($1,'Quiz question?','mcq','{"A":"Yes","B":"No"}','A',2,$2) RETURNING *`,
    [fixtures.topic.id, fixtures.teacher.id]
  );
  const { rows: [quiz] } = await pool.query(
    `INSERT INTO quizzes (title, topic_id, is_adaptive, created_by) VALUES ($1,$2,false,$3) RETURNING *`,
    ['Original Quiz', fixtures.topic.id, fixtures.teacher.id]
  );
  await pool.query(
    `INSERT INTO quiz_questions (quiz_id, question_id, order_index) VALUES ($1,$2,0)`,
    [quiz.id, q.id]
  );
  return { quiz, question: q };
}

describe('PATCH /api/v1/quizzes/:id', () => {
  it('edits title and topic', async () => {
    const { rows: [otherTopic] } = await pool.query(
      `INSERT INTO topics (title, order_index) VALUES ('Other Topic', 2) RETURNING *`
    );
    const { quiz } = await createQuiz(fixtures);

    const res = await request(app)
      .patch(`/api/v1/quizzes/${quiz.id}`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ title: 'Renamed Quiz', topic_id: otherTopic.id });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed Quiz');
    expect(res.body.topic_id).toBe(otherTopic.id);
  });

  it('leaves the quiz question composition untouched', async () => {
    const { quiz, question } = await createQuiz(fixtures);
    await request(app)
      .patch(`/api/v1/quizzes/${quiz.id}`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ title: 'Renamed Quiz' });

    const { rows } = await pool.query('SELECT question_id FROM quiz_questions WHERE quiz_id = $1', [quiz.id]);
    expect(rows.map((r) => r.question_id)).toEqual([question.id]);
  });

  it('rejects a missing title with a clear message, not a 500', async () => {
    const { quiz } = await createQuiz(fixtures);
    const res = await request(app)
      .patch(`/api/v1/quizzes/${quiz.id}`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ topic_id: fixtures.topic.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('rejects a student trying to edit a quiz', async () => {
    const { quiz } = await createQuiz(fixtures);
    const res = await request(app)
      .patch(`/api/v1/quizzes/${quiz.id}`)
      .set('Authorization', `Bearer ${fixtures.student.token}`)
      .send({ title: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for a quiz that does not exist', async () => {
    const res = await request(app)
      .patch('/api/v1/quizzes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ title: 'Ghost quiz' });
    expect(res.status).toBe(404);
  });
});

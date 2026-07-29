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

describe('PATCH /api/v1/topics/:id', () => {
  it('edits title, description, and level', async () => {
    const res = await request(app)
      .patch(`/api/v1/topics/${fixtures.topic.id}`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ title: 'Renamed Topic', description: 'New description', level: 'A-Level' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed Topic');
    expect(res.body.description).toBe('New description');
    expect(res.body.level).toBe('A-Level');
  });

  it('rejects a missing title with a clear message, not a 500', async () => {
    const res = await request(app)
      .patch(`/api/v1/topics/${fixtures.topic.id}`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ description: 'No title here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('rejects a student trying to edit a topic', async () => {
    const res = await request(app)
      .patch(`/api/v1/topics/${fixtures.topic.id}`)
      .set('Authorization', `Bearer ${fixtures.student.token}`)
      .send({ title: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for a topic that does not exist', async () => {
    const res = await request(app)
      .patch('/api/v1/topics/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ title: 'Ghost topic' });
    expect(res.status).toBe(404);
  });

  it('does not disturb existing questions filed under the topic', async () => {
    const { rows: [q] } = await pool.query(
      `INSERT INTO questions (topic_id, question_text, question_type, options, correct_answer, difficulty, created_by)
       VALUES ($1,'Still here?','mcq','{"A":"Yes","B":"No"}','A',2,$2) RETURNING *`,
      [fixtures.topic.id, fixtures.teacher.id]
    );
    await request(app)
      .patch(`/api/v1/topics/${fixtures.topic.id}`)
      .set('Authorization', `Bearer ${fixtures.teacher.token}`)
      .send({ title: 'Renamed again' });

    const { rows } = await pool.query('SELECT topic_id FROM questions WHERE id = $1', [q.id]);
    expect(rows[0].topic_id).toBe(fixtures.topic.id);
  });
});

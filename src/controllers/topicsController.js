const pool = require('../config/db');

async function listTopics(req, res) {
  // question_count comes along for the ride so the portal's Topics page
  // doesn't have to download the entire question bank just to tally it.
  const { rows } = await pool.query(
    `SELECT t.*, COUNT(q.id)::int AS question_count
     FROM topics t
     LEFT JOIN questions q ON q.topic_id = t.id AND q.archived_at IS NULL
     GROUP BY t.id
     ORDER BY t.order_index ASC, t.title ASC`
  );
  res.json(rows);
}

async function createTopic(req, res) {
  const { title, description, level, order_index } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const { rows } = await pool.query(
    `INSERT INTO topics (title, description, level, order_index)
     VALUES ($1, $2, COALESCE($3, 'O-Level'), COALESCE($4, 0))
     RETURNING *`,
    [title, description || null, level, order_index]
  );
  res.status(201).json(rows[0]);
}

module.exports = { listTopics, createTopic };

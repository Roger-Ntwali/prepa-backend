const pool = require('../config/db');

async function listTopics(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM topics ORDER BY order_index ASC, title ASC'
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

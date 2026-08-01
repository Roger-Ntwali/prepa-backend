const pool = require('../config/db');
const { parsePageLimit } = require('../utils/pagination');

async function listTopics(req, res) {
  try {
    // question_count comes along for the ride so the portal's Topics page
    // doesn't have to download the entire question bank just to tally it.
    const baseSql = `SELECT t.*, COUNT(q.id)::int AS question_count
       FROM topics t
       LEFT JOIN questions q ON q.topic_id = t.id AND q.archived_at IS NULL
       GROUP BY t.id
       ORDER BY t.order_index ASC, t.title ASC`;

    // Opt-in, same as questionsController.listQuestions: the mobile app
    // calls this endpoint too and never sends ?page, so its full-list fetch
    // is untouched -- the body stays a bare array either way, with the
    // total riding on a header when pagination is actually requested.
    if (req.query.page) {
      const { limit, offset } = parsePageLimit(req);
      const [{ rows }, { rows: countRows }] = await Promise.all([
        pool.query(`${baseSql} LIMIT $1 OFFSET $2`, [limit, offset]),
        pool.query('SELECT COUNT(*)::int AS total FROM topics'),
      ]);
      res.set('X-Total-Count', String(countRows[0].total));
      return res.json(rows);
    }

    const { rows } = await pool.query(baseSql);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load topics' });
  }
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

// No answered-history concern here -- unlike a question's correct_answer,
// nothing about a topic retroactively changes whether any past answer
// was right.
async function updateTopic(req, res) {
  const { id } = req.params;
  const { title, description, level, order_index } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const { rows } = await pool.query(
    `UPDATE topics SET title = $1, description = $2, level = COALESCE($3, level),
       order_index = COALESCE($4, order_index)
     WHERE id = $5
     RETURNING *`,
    [title, description || null, level, order_index, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Topic not found' });
  res.json(rows[0]);
}

module.exports = { listTopics, createTopic, updateTopic };

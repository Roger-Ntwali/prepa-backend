const pool = require('../config/db');

async function listPastPapers(req, res) {
  const { rows } = await pool.query(
    `SELECT id, title, year, term, topic_id, file_url, created_at
     FROM past_papers ORDER BY year DESC`
  );
  res.json({ past_papers: rows });
}

// Admin-only. Expects the PDF to already be placed in the uploads/ folder
// (e.g. uploads/biology-2025-2026-exam.pdf); this just registers its
// metadata so the app and sync pull can see it. Kept simple — no file
// upload middleware — since exam PDFs are added rarely and manually by
// an admin who already has server access.
async function createPastPaper(req, res) {
  const { title, year, term, topic_id, file_url } = req.body;
  if (!title || !year) {
    return res.status(400).json({ error: 'title and year are required' });
  }
  const { rows } = await pool.query(
    `INSERT INTO past_papers (title, year, term, topic_id, file_url, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, year, term, topic_id, file_url, created_at`,
    [title, year, term || null, topic_id || null, file_url || null, req.user.id]
  );
  res.status(201).json({ past_paper: rows[0] });
}

module.exports = { listPastPapers, createPastPaper };

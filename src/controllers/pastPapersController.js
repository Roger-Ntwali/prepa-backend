const pool = require('../config/db');
const { signUploadPath } = require('../utils/signedUrl');

async function listPastPapers(req, res) {
  const { rows } = await pool.query(
    `SELECT id, title, year, term, topic_id, file_url, created_at
     FROM past_papers WHERE archived_at IS NULL ORDER BY year DESC`
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

// questions.past_paper_id is ON DELETE SET NULL, so removing a paper never
// destroys the questions imported from it — they just stop pointing back at
// it. Archive when questions still reference the paper, so that link
// survives; hard-delete when nothing does.
async function deletePastPaper(req, res) {
  const { id } = req.params;

  const existing = await pool.query('SELECT id FROM past_papers WHERE id = $1', [id]);
  if (!existing.rows.length) {
    return res.status(404).json({ error: 'Past paper not found' });
  }

  const linked = await pool.query(
    'SELECT COUNT(*)::int AS n FROM questions WHERE past_paper_id = $1',
    [id]
  );
  const count = linked.rows[0].n;

  if (count > 0) {
    await pool.query('UPDATE past_papers SET archived_at = now() WHERE id = $1', [id]);
    return res.json({
      id,
      action: 'archived',
      message: `This paper was archived rather than deleted because ${count} question${count === 1 ? '' : 's'} in the bank came from it. Those questions are untouched.`,
    });
  }

  await pool.query('DELETE FROM past_papers WHERE id = $1', [id]);
  res.json({ id, action: 'deleted', message: 'Past paper removed.' });
}

// The /uploads static route requires a signature (see server.js), so
// clients can't link straight to file_url anymore — they call this first
// to mint a link that's valid for a few minutes, then navigate to it.
async function getDownloadUrl(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(
    'SELECT file_url FROM past_papers WHERE id = $1 AND archived_at IS NULL',
    [id]
  );
  if (!rows.length || !rows[0].file_url) {
    return res.status(404).json({ error: 'No file available for this paper' });
  }

  const relPath = rows[0].file_url.replace(/^\/?uploads\//, '');
  const { exp, sig } = signUploadPath(relPath);
  const url = `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(relPath)}?exp=${exp}&sig=${sig}`;
  res.json({ url, expires_at: new Date(exp).toISOString() });
}

module.exports = { listPastPapers, createPastPaper, deletePastPaper, getDownloadUrl };

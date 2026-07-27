const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

// Both past-paper routes (register directly, or via PDF import) need to
// turn an in-memory multer buffer into a file students can actually open
// later through GET /past-papers/:id/download-url. One place to do that
// consistently: a safe filename (never the client-supplied name/path
// verbatim) plus a short random suffix so two papers with the same title
// in the same year don't collide.
async function saveUploadedPdf(file, { title } = {}) {
  const base = (title || 'past-paper')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'past-paper';
  const suffix = crypto.randomBytes(4).toString('hex');
  const filename = `${base}-${suffix}.pdf`;

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, filename), file.buffer);

  return `/uploads/${filename}`;
}

module.exports = { saveUploadedPdf };

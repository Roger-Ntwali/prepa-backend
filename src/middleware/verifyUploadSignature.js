const { verifyUploadPath } = require('../utils/signedUrl');

// Sits in front of express.static('/uploads'). Every file under /uploads is
// exam material — without this, anyone with a guessed or leaked filename
// could fetch it with no login at all. requireAuth doesn't work here: a
// plain <a href> or an external PDF viewer never sends an Authorization
// header, so the signature in the query string carries the auth instead.
function verifyUploadSignature(req, res, next) {
  const relPath = decodeURIComponent(req.path.replace(/^\/+/, ''));
  const { exp, sig } = req.query;
  if (!verifyUploadPath(relPath, exp, sig)) {
    return res.status(401).json({ error: 'Missing, invalid, or expired download link' });
  }
  next();
}

module.exports = verifyUploadSignature;

const crypto = require('crypto');

// Signs paths under /uploads so a browser can navigate to a PDF directly
// (plain <a href>, or a mobile external-viewer launch) without needing to
// attach an Authorization header, which normal navigation never does.
// The signature carries the auth instead: the API issues a short-lived
// link, the static file server checks the signature before serving.
const SECRET = process.env.UPLOADS_SECRET || process.env.JWT_SECRET;
const DEFAULT_TTL_SECONDS = 5 * 60;

function hmac(relPath, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${relPath}:${exp}`).digest('hex');
}

function signUploadPath(relPath, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const exp = Date.now() + ttlSeconds * 1000;
  return { exp, sig: hmac(relPath, exp) };
}

function verifyUploadPath(relPath, exp, sig) {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;

  const expected = hmac(relPath, expNum);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { signUploadPath, verifyUploadPath };

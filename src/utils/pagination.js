// Shared by every list endpoint's pagination: page/limit come in as strings
// off req.query and are never used as raw SQL, just clamped numbers for
// LIMIT/OFFSET.
function parsePageLimit(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { parsePageLimit };

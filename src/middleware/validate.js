const { validationResult } = require('express-validator');

// Runs after a route's validation chain. express-validator collects
// failures into req; this turns the first one into the same
// `{ error: '...' }` shape every controller in this API already returns,
// so validation errors are indistinguishable from the manual checks they
// replace.
function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const first = result.array()[0];
  res.status(400).json({ error: first.msg });
}

module.exports = { validate };

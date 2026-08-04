const pool = require('../config/db');

// Normalizing (lowercase, collapse whitespace) before comparing catches
// "the same question with different spacing/capitalization" as a
// duplicate without needing a fuzzy-match library for a plain equality
// check. Deliberately not scoped to a single topic -- the same question
// text showing up under two different topics is still a duplicate.
// excludeId lets an update check every OTHER question without matching
// itself.
async function findDuplicateQuestion(questionText, excludeId) {
  const params = [questionText];
  let clause = '';
  if (excludeId) {
    params.push(excludeId);
    clause = 'AND id != $2';
  }
  const { rows } = await pool.query(
    `SELECT id FROM questions
     WHERE archived_at IS NULL ${clause}
       AND lower(regexp_replace(question_text, '\\s+', ' ', 'g')) = lower(regexp_replace($1, '\\s+', ' ', 'g'))
     LIMIT 1`,
    params
  );
  return rows[0]?.id || null;
}

module.exports = { findDuplicateQuestion };

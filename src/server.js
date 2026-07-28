const app = require('./app');
const pool = require('./config/db');

const PORT = process.env.PORT || 4000;

// Confirms DATABASE_URL actually resolves to a reachable Postgres before
// accepting any traffic -- without this, a wrong/unreachable DB doesn't
// surface until the first request fails (or, for a merely misconfigured
// but reachable DB, never surfaces at all -- it just serves whatever's in
// that database and looks like an empty app).
async function verifyDatabaseConnection() {
  try {
    const { rows } = await pool.query(
      "SELECT current_database() AS db, (SELECT COUNT(*) FROM users WHERE role = 'student')::int AS students"
    );
    console.log(`Connected to Postgres database "${rows[0].db}" (${rows[0].students} student user(s) found).`);
  } catch (err) {
    console.error('FATAL: could not reach the database configured in DATABASE_URL.');
    console.error(err.message);
    process.exit(1);
  }
}

verifyDatabaseConnection().then(() => {
  app.listen(PORT, () => {
    console.log(`PREPA backend listening on port ${PORT}`);
  });
});

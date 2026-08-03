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

// RESEND_FROM_EMAIL unset means every reset-code email sends from Resend's
// shared sandbox address (onboarding@resend.dev) -- which Resend's free
// tier only allows delivering to the Resend account owner's own address,
// rejecting every other recipient with a 403. Logged once at boot so this
// is the first thing anyone sees when debugging "the reset email never
// arrived", instead of rediscovering it from a live failure each time.
if (!process.env.RESEND_FROM_EMAIL) {
  console.warn(
    'Resend free tier: RESEND_FROM_EMAIL is not set, so reset-code emails send from the shared ' +
    'onboarding@resend.dev sandbox address. Without a verified domain, Resend only delivers this ' +
    "to the Resend account's own email -- every other recipient gets rejected with a 403. " +
    'Verify a domain at resend.com/domains and set RESEND_FROM_EMAIL to fix this for real ' +
    'students.'
  );
}

verifyDatabaseConnection().then(() => {
  app.listen(PORT, () => {
    console.log(`PREPA backend listening on port ${PORT}`);
  });
});

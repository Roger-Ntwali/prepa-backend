const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// pg's Pool already discards a broken idle client and opens a new one on
// the next checkout -- Neon in particular drops idle connections often.
// Exiting the whole process here (the previous behavior) took the entire
// server offline for every user over something the pool recovers from on
// its own; log it and stay up, consistent with the log-and-continue policy
// for unhandledRejection/uncaughtException in app.js.
pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client (pool will recover):', err);
});

module.exports = pool;

// Runs before Jest loads any test file or app code. dotenv (required by
// src/config/db.js) never overwrites an already-set process.env value, so
// setting these here first is what keeps tests off the real dev database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://prepa_user:prepa_pass@localhost:5432/prepa_test';
process.env.JWT_SECRET = 'test-only-secret-not-for-real-use';
process.env.JWT_EXPIRES_IN = '1h';
process.env.UPLOADS_SECRET = 'test-only-uploads-secret';
// Left unset: GEMINI_API_KEY -- AI endpoints should 503 cleanly in tests,
// exactly like a real deployment missing the key, rather than hitting a
// real (billed) API during CI.

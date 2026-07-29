const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Brute-force protection on the two unauthenticated entry points. Keyed by
// IP (the only thing we have pre-auth). 429 with Retry-After, matching
// express-rate-limit's default response shape.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// The mobile AI Tutor client already assumes this exact contract — its own
// doc comment (lib/repositories/ai_tutor_repository.dart) describes the
// tutor endpoint as "rate limited server-side (20/hour/student)" and the
// chat screen already renders a dedicated message when it gets a 429. This
// keys by authenticated user (not IP), since requireAuth runs first and a
// shared school network shouldn't throttle every student on it together.
const aiTutorLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'You have reached the hourly limit for AI tutor questions. Try again later.' },
});

// Teacher/admin AI authoring tools call Gemini too, but are used far less
// often per person than student chat — a looser cap is just cost control,
// not a UX-critical contract like the tutor's.
const aiAuthoringLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'You have reached the hourly limit for AI-assisted authoring. Try again later.' },
});

// Stricter than authLimiter: every hit here that matches a real account
// sends an actual email (Resend quota/cost), and this is exactly the kind
// of endpoint someone could otherwise abuse to spam a stranger's inbox
// with reset codes, not just brute-force a password.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

module.exports = { authLimiter, aiTutorLimiter, aiAuthoringLimiter, forgotPasswordLimiter };

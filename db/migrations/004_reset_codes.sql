-- ── Admin-issued password reset codes ───────────────────
--
-- An admin can generate a one-time 6-digit code for a teacher whose
-- account they manage (see usersController.resetTeacherPassword). The
-- teacher exchanges it, along with their email and a new password, at
-- POST /auth/reset-password (see authController.resetPasswordWithCode).
-- The code is single-use: a successful exchange clears both columns.

ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(6);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires_at TIMESTAMPTZ;

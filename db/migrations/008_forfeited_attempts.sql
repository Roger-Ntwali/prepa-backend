-- Anti-cheating: a quiz attempt is forfeited (scored 0) if the student
-- leaves the quiz screen or backgrounds the app mid-quiz. `quiz_id` alone
-- can't identify a session for practice mode (it has no quiz_id at all,
-- and grouped by an empty string every practice answer pushed in one sync
-- batch would collide into a single fake "session"), so the app now sends
-- its own client-generated session_id per quiz-taking screen instance --
-- this is the real, mode-agnostic session boundary. Nullable so rows
-- synced by an app version before this change still work exactly as
-- before (falls back to the old quiz_id grouping in syncController.js).
ALTER TABLE quiz_attempts ADD COLUMN session_id VARCHAR(100);
ALTER TABLE quiz_attempts ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'completed';
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_session_id ON quiz_attempts (session_id);

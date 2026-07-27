-- ── Soft delete support ─────────────────────────────────
--
-- Teachers need to remove questions, quizzes and papers that were added by
-- mistake or have gone out of syllabus. A plain DELETE is unsafe here:
-- attempt_answers.question_id is ON DELETE CASCADE, so deleting a question
-- students have already answered would silently erase those answers and
-- change every past score and topic-accuracy figure derived from them.
--
-- So: archive anything with history, hard-delete only what has none. The
-- controllers decide which applies; these columns are what archiving sets.

ALTER TABLE questions   ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE quizzes     ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE past_papers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Every listing filters on archived_at IS NULL, so index for it.
CREATE INDEX IF NOT EXISTS idx_questions_active
  ON questions (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quizzes_active
  ON quizzes (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_past_papers_active
  ON past_papers (archived_at) WHERE archived_at IS NULL;

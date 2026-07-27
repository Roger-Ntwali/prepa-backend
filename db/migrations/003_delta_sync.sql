-- ── Delta sync support ──────────────────────────────────
--
-- The mobile app already sends `?last_sync=<timestamp>` on every
-- /sync/pull after its first login (see SyncService.syncCycle /
-- ApiClient.syncPull), expecting only rows changed since then back.
-- The backend had nothing to filter on, so it silently ignored
-- last_sync and returned the entire dataset every time -- correct but
-- wasteful today; it will not scale once the question bank grows past
-- a single Biology pilot.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE topics         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE questions       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE quizzes         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE quiz_questions  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE past_papers     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_topics_updated_at ON topics;
CREATE TRIGGER trg_topics_updated_at BEFORE UPDATE ON topics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_questions_updated_at ON questions;
CREATE TRIGGER trg_questions_updated_at BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_quizzes_updated_at ON quizzes;
CREATE TRIGGER trg_quizzes_updated_at BEFORE UPDATE ON quizzes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_quiz_questions_updated_at ON quiz_questions;
CREATE TRIGGER trg_quiz_questions_updated_at BEFORE UPDATE ON quiz_questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_past_papers_updated_at ON past_papers;
CREATE TRIGGER trg_past_papers_updated_at BEFORE UPDATE ON past_papers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every delta query below filters on updated_at, so index it.
CREATE INDEX IF NOT EXISTS idx_topics_updated_at ON topics (updated_at);
CREATE INDEX IF NOT EXISTS idx_questions_updated_at ON questions (updated_at);
CREATE INDEX IF NOT EXISTS idx_quizzes_updated_at ON quizzes (updated_at);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_updated_at ON quiz_questions (updated_at);
CREATE INDEX IF NOT EXISTS idx_past_papers_updated_at ON past_papers (updated_at);

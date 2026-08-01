-- Students are soft-deleted the same way questions/quizzes already are:
-- a student with quiz history gets archived (hidden, history preserved)
-- instead of hard-deleted. `is_active` already means "teacher pending
-- approval" elsewhere in this codebase, so it can't be reused here without
-- colliding with that meaning -- hence a dedicated column.
ALTER TABLE users ADD COLUMN archived_at TIMESTAMPTZ;

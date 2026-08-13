-- Students.jsx now shows each student's most-recent quiz attempt inline
-- (a LATERAL "top-1 per student" query, ordered by completed_at) --
-- the existing idx_attempts_student only covers the student_id half of
-- that lookup. A composite index lets Postgres satisfy "latest completed
-- attempt for this student" with an index scan instead of a per-student
-- sort over every attempt they've ever made.
CREATE INDEX IF NOT EXISTS idx_attempts_student_completed
  ON quiz_attempts (student_id, completed_at DESC);

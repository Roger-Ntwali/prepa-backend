-- PREPA database schema (v1)
-- Scope: O-Level Biology, APACE Secondary School pilot

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ── Schools ──────────────────────────────────────────────
CREATE TABLE schools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(150) NOT NULL,
  district      VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Users (students, teachers, admin) ───────────────────
CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID REFERENCES schools(id) ON DELETE SET NULL,
  role          user_role NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(150) UNIQUE,
  username      VARCHAR(50) UNIQUE,      -- students may log in with a simple username
  password_hash VARCHAR(255) NOT NULL,
  class_level   VARCHAR(20),             -- e.g. "Senior 3" (students only)
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Topics (Biology syllabus breakdown) ─────────────────
CREATE TABLE topics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(150) NOT NULL,
  description   TEXT,
  level         VARCHAR(20) NOT NULL DEFAULT 'O-Level',
  order_index   INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Past papers (REB Biology exam papers) ───────────────
CREATE TABLE past_papers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(200) NOT NULL,
  year          INTEGER NOT NULL,
  term          VARCHAR(20),
  topic_id      UUID REFERENCES topics(id) ON DELETE SET NULL,
  file_url      VARCHAR(500),            -- stored asset (served for offline download)
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Questions (practice bank, sourced from past papers or authored) ──
CREATE TYPE question_type AS ENUM ('mcq', 'short_answer', 'structured');

CREATE TABLE questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id       UUID REFERENCES topics(id) ON DELETE CASCADE,
  past_paper_id  UUID REFERENCES past_papers(id) ON DELETE SET NULL,
  question_text  TEXT NOT NULL,
  question_type  question_type NOT NULL DEFAULT 'mcq',
  options        JSONB,                  -- e.g. {"A": "...", "B": "...", "C": "...", "D": "..."}
  correct_answer TEXT NOT NULL,
  explanation    TEXT,                   -- shown after answering (offline-cached)
  difficulty     SMALLINT DEFAULT 2,     -- 1=easy .. 3=hard, drives adaptive selection
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Quizzes (a set of questions assembled for practice) ─
CREATE TABLE quizzes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(200) NOT NULL,
  topic_id      UUID REFERENCES topics(id) ON DELETE SET NULL,
  is_adaptive   BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quiz_questions (
  quiz_id       UUID REFERENCES quizzes(id) ON DELETE CASCADE,
  question_id   UUID REFERENCES questions(id) ON DELETE CASCADE,
  order_index   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (quiz_id, question_id)
);

-- ── Attempts (recorded locally offline, synced later) ───
CREATE TABLE quiz_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       UUID REFERENCES quizzes(id) ON DELETE SET NULL,
  student_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  device_id     VARCHAR(100),            -- identifies the offline device for sync tracing
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  score         NUMERIC(5,2),
  synced_at     TIMESTAMPTZ,             -- null until background sync completes
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attempt_answers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id        UUID REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id       UUID REFERENCES questions(id) ON DELETE CASCADE,
  selected_answer   TEXT,
  is_correct        BOOLEAN,
  time_spent_seconds INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── AI tutoring sessions (online-only feature) ──────────
CREATE TABLE ai_tutor_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  topic_id      UUID REFERENCES topics(id) ON DELETE SET NULL,
  question_id   UUID REFERENCES questions(id) ON DELETE SET NULL,
  prompt        TEXT NOT NULL,
  response      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Sync log (audit trail for offline -> online sync) ───
CREATE TABLE sync_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  device_id     VARCHAR(100),
  sync_type     VARCHAR(50),             -- e.g. 'quiz_attempts', 'profile'
  status        VARCHAR(20) DEFAULT 'success',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX idx_users_school ON users(school_id);
CREATE INDEX idx_questions_topic ON questions(topic_id);
CREATE INDEX idx_attempts_student ON quiz_attempts(student_id);
CREATE INDEX idx_attempt_answers_attempt ON attempt_answers(attempt_id);
CREATE INDEX idx_ai_sessions_student ON ai_tutor_sessions(student_id);

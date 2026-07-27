# PREPA Backend

Node.js/Express API + PostgreSQL for PREPA, an offline-first exam
preparation platform (REB O-Level Biology, APACE Secondary School
pilot). Serves the [Flutter student app](https://github.com/Roger-Ntwali/Prepa-System/tree/main/prepa_mobile-v11)
and the [React teacher/admin portal](https://github.com/Roger-Ntwali/Prepa-System/tree/main/prepa-portal-v2).

## Setup

```bash
npm install
cp .env.example .env        # then edit JWT_SECRET, GEMINI_API_KEY, etc.

# Start Postgres (requires Docker)
docker compose up -d

# Run migrations
npm run migrate

# Seed sample data (APACE school, syllabus topics/questions, test accounts)
npm run seed

# Start the API
npm run dev                 # http://localhost:4000
```

## Test accounts (after seeding)

| Role    | Login             | Password    |
|---------|-------------------|-------------|
| Teacher | teacher@apace.test | teacher123 |
| Student | student1           | student123 |

## Tests

```bash
npm test
```

Runs against a separate `prepa_test` database (not the one above),
migrated fresh by a `pretest` script — it never touches your dev data.
CI (`.github/workflows/ci.yml`) runs the same suite against a real
Postgres service container on every push.

## Quick check

```bash
curl http://localhost:4000/api/v1/health

curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"student1","password":"student123"}'
```

## Endpoints

All paths are under `/api/v1`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET    | /health | none | liveness check |
| POST   | /auth/register | none, rate-limited | create an account (teacher accounts need admin approval) |
| POST   | /auth/login | none, rate-limited | get a JWT |
| GET    | /sync/pull | any user | offline-first full/delta pull (`?last_sync=<ISO timestamp>` for deltas) |
| POST   | /sync/push | any user | the mobile app's actual attempt-sync endpoint (idempotent, client-generated ids) |
| GET    | /topics | any user | list syllabus topics |
| POST   | /topics | teacher/admin | add a topic |
| GET    | /questions | any user | list questions (`?topic_id=`, `?past_paper_id=`) |
| GET    | /questions/export | any user | full bank, for the mobile app's offline cache |
| POST   | /questions/generate | teacher/admin, rate-limited | AI-drafted options/answer for a question stem (Gemini) |
| POST   | /questions | teacher/admin | author a question |
| POST   | /questions/import-pdf | teacher/admin, rate-limited | upload a PDF, AI extracts questions into the bank (Gemini) |
| DELETE | /questions/:id | teacher/admin | remove a question (archives instead of deleting if students have answered it) |
| PATCH  | /questions/:id/restore | teacher/admin | un-archive a question |
| POST   | /quizzes | teacher/admin | assemble a quiz from existing questions |
| GET    | /quizzes | any user | list published (non-adaptive) quizzes |
| GET    | /quizzes/:id | any user | fetch a quiz + its questions |
| DELETE | /quizzes/:id | teacher/admin | remove a quiz (archives instead of deleting if students have taken it) |
| GET    | /quizzes/practice/adaptive | student | adaptive practice set (weak topics first) |
| GET    | /past-papers | any user | list registered past papers |
| POST   | /past-papers | admin | register a past paper, optionally with a PDF upload |
| DELETE | /past-papers/:id | admin | remove a past paper (archives if questions were imported from it) |
| GET    | /past-papers/:id/download-url | any user | mint a short-lived signed link to the PDF (see "File downloads" below) |
| POST   | /attempts/sync | student | batch-sync a nested quiz-session shape (currently unused by the shipped app — see `/sync/push`) |
| GET    | /attempts/mine | student | a student's own attempt history |
| POST   | /ai-tutor/ask, /ai/tutor | student, rate-limited | ask the AI tutor (online-only; both paths hit the same handler) |
| GET    | /users/students | teacher/admin | student roster with attempt counts/scores |
| GET    | /users/pending-teachers | admin | teacher signups awaiting approval |
| PATCH  | /users/:id/approve | admin | approve a pending teacher |
| DELETE | /users/:id/reject | admin | reject (and delete) a pending teacher |
| GET    | /reports/class-summary | teacher/admin | one aggregated query for the portal dashboard |
| GET    | /reports/students/:id | teacher/admin | per-student topic accuracy + recent attempts |

## Design notes

- **Offline-first**: the mobile app pulls `/sync/pull` once at login (full
  snapshot) and then with `?last_sync=` on every reconnect (delta only,
  filtered on each table's `updated_at`). Every quiz/practice answer is
  recorded locally regardless of connectivity and pushed via `/sync/push`
  in a batch, keyed by a client-generated UUID so a retry after a dropped
  connection is idempotent.
- **File downloads are signed, not public**: `/uploads` requires a
  short-lived HMAC signature (`exp`+`sig` query params) minted by
  `/past-papers/:id/download-url` — a plain link to `/uploads/<file>.pdf`
  with no signature is rejected. This exists because browsers and
  external PDF viewers never attach an `Authorization` header on a normal
  navigation.
- **Soft delete**: removing a question, quiz, or past paper archives it
  instead of hard-deleting whenever a student's history depends on it
  (an answered question, a taken quiz, a paper questions were imported
  from) — archived rows are gone from every listing and from the app,
  but the data they underpin is untouched.
- **AI is Gemini**, called server-side only (`src/utils/gemini.js`) —
  neither client ever holds an API key. Three features: the student AI
  tutor, teacher question-answer drafting, and PDF-to-questions import.
- **Adaptive practice** (`/quizzes/practice/adaptive`) looks at a
  student's past incorrect answers to bias topic selection.

## Known gaps

- `/attempts/sync` (nested quiz-session shape) has no caller in the
  shipped mobile app — it always uses `/sync/push` (flat per-question
  shape) instead. Kept for now rather than removed.
- Delta sync (`?last_sync=`) excludes archived rows entirely rather than
  flagging them for client-side removal — a row archived between two
  delta pulls lingers in an already-synced client until its next full
  pull (at login). See `syncController.js` for the full reasoning.

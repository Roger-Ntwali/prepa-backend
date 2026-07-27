# PREPA Backend (Step 1: Foundation)

Node.js/Express API + PostgreSQL for the PREPA offline-first exam
preparation platform (O-Level Biology, APACE Secondary School pilot).

## Setup

```bash
npm install
cp .env.example .env        # then edit JWT_SECRET, ANTHROPIC_API_KEY, etc.

# Start Postgres (requires Docker)
docker compose up -d

# Run migrations
npm run migrate

# Seed sample data (APACE school, 1 topic, 2 questions, test accounts)
npm run seed

# Start the API
npm run dev                 # http://localhost:4000
```

## Test accounts (after seeding)

| Role    | Login             | Password    |
|---------|-------------------|-------------|
| Teacher | teacher@apace.test | teacher123 |
| Student | student1           | student123 |

## Quick check

```bash
curl http://localhost:4000/api/v1/health

curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"student1","password":"student123"}'
```

## Endpoints so far

| Method | Path                              | Auth           | Purpose |
|--------|------------------------------------|----------------|---------|
| GET    | /api/v1/health                     | none           | liveness check |
| POST   | /api/v1/auth/register              | none           | create account |
| POST   | /api/v1/auth/login                 | none           | get JWT |
| GET    | /api/v1/topics                     | any user       | list syllabus topics |
| POST   | /api/v1/topics                     | teacher/admin  | add a topic |
| GET    | /api/v1/questions                  | any user       | list questions (filter by topic_id) |
| GET    | /api/v1/questions/export           | any user       | full bank, for the mobile app's offline cache |
| POST   | /api/v1/questions                  | teacher/admin  | author a question |
| POST   | /api/v1/quizzes                    | teacher/admin  | assemble a quiz |
| GET    | /api/v1/quizzes/:id                | any user       | fetch quiz + questions |
| GET    | /api/v1/quizzes/practice/adaptive  | student        | adaptive practice set (weak topics first) |
| POST   | /api/v1/attempts/sync              | student        | batch-sync offline quiz attempts |
| GET    | /api/v1/attempts/mine              | student        | a student's attempt history |
| POST   | /api/v1/ai-tutor/ask               | student        | ask the LLM tutor (online only) |

## Design notes

- **Offline-first**: the mobile app is expected to pull `/questions/export`
  once (or per topic) and cache it in SQLite/AsyncStorage. Students take
  quizzes fully offline, and `/attempts/sync` accepts a batch of locally
  recorded attempts once connectivity returns.
- **Adaptive practice**: `/quizzes/practice/adaptive` looks at a student's
  past incorrect answers to bias topic selection — this is the seed of the
  "adaptive practice quizzes" described in the proposal; it can be
  extended with a proper spaced-repetition/IRT model later.
- **AI tutoring is online-only** by design, matching the proposal: it is
  gated behind the same auth as everything else, but only makes sense with
  connectivity, so the mobile app should surface it conditionally.

## Next steps

1. Add input validation (`express-validator`) on all POST routes.
2. Write integration tests for auth + sync flow.
3. Build the React.js teacher/admin portal against this API.
4. Build the React Native (Expo) student app with offline SQLite caching.
5. Deploy: Neon/Supabase (Postgres) + Render/Railway (API).

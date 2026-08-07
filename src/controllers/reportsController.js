const pool = require('../config/db');

// Per-student detail: accuracy by topic (to surface weak areas) plus a
// simple attempt history, for the admin/teacher dashboard's student view.
async function studentDetail(req, res) {
  const { id } = req.params;

  try {
    const [studentRes, topicRes, historyRes] = await Promise.all([
      pool.query(
        `SELECT id, full_name, username, class_level FROM users WHERE id = $1 AND role = 'student'`,
        [id]
      ),
      pool.query(
        `SELECT
           t.id AS topic_id, t.title AS topic_title,
           COUNT(aa.id)::int AS answered,
           COUNT(aa.id) FILTER (WHERE aa.is_correct)::int AS correct
         FROM attempt_answers aa
         JOIN quiz_attempts qa ON qa.id = aa.attempt_id
         JOIN questions q ON q.id = aa.question_id
         JOIN topics t ON t.id = q.topic_id
         WHERE qa.student_id = $1
         GROUP BY t.id, t.title
         ORDER BY t.title ASC`,
        [id]
      ),
      pool.query(
        `SELECT qa.id, qz.title AS quiz_title, qa.score, qa.status, qa.completed_at
         FROM quiz_attempts qa
         LEFT JOIN quizzes qz ON qz.id = qa.quiz_id
         WHERE qa.student_id = $1 AND qa.completed_at IS NOT NULL
         ORDER BY qa.completed_at DESC
         LIMIT 20`,
        [id]
      ),
    ]);

    if (!studentRes.rows.length) return res.status(404).json({ error: 'Student not found' });

    const topics = topicRes.rows.map((t) => ({
      topic_id: t.topic_id,
      topic_title: t.topic_title,
      answered: t.answered,
      correct: t.correct,
      accuracy: t.answered ? Math.round((t.correct / t.answered) * 100) : null,
    }));

    // Weakest first — topics with the lowest accuracy (and at least a few
    // attempts, so one lucky/unlucky question doesn't dominate the ranking).
    const weakTopics = [...topics]
      .filter((t) => t.answered >= 3)
      .sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100))
      .slice(0, 3);

    res.json({
      student: studentRes.rows[0],
      topics,
      weak_topics: weakTopics,
      recent_attempts: historyRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load student detail' });
  }
}

// Class-wide rollup for the portal dashboard. This exists because the
// dashboard used to build the same picture by fetching studentDetail once
// per student — N+1 over HTTP, which stalled the page on a real class.
// One grouped query replaces all of it.
async function classSummary(req, res) {
  try {
  const { class_level, range } = req.query;
  // "all" maps to a interval wide enough to never exclude a real row --
  // simplest way to share one query shape between "no range filter" and
  // "last N days" rather than branching the SQL string itself.
  const rangeInterval = range === '7d' ? '7 days' : range === '30d' ? '30 days' : '100 years';

  // Shared by every attempt-based query below: class_level narrows to one
  // class (via a join to users, since quiz_attempts itself has no
  // class_level column), range narrows to a rolling window. Both optional
  // and independent, content-only queries (bank totals, difficulty mix)
  // deliberately ignore both -- "how many questions exist" isn't scoped to
  // a class or a date range the way "how did students do" is.
  const classParams = [];
  let classClause = '';
  if (class_level) {
    classParams.push(class_level);
    classClause = `AND u.class_level = $${classParams.length}`;
  }
  const rangeParamIndex = classParams.length + 1;
  const attemptParams = [...classParams, rangeInterval];

  const [
    topicRes, totalsRes, activeRes, difficultyRes, trendRes, classesRes,
  ] = await Promise.all([
    // Accuracy per topic, scoped to the filtered class/range.
    pool.query(
      `SELECT
         t.id AS topic_id, t.title AS topic_title,
         COUNT(aa.id)::int AS answered,
         COUNT(aa.id) FILTER (WHERE aa.is_correct)::int AS correct
       FROM attempt_answers aa
       JOIN quiz_attempts qa ON qa.id = aa.attempt_id
       JOIN users u ON u.id = qa.student_id
       JOIN questions q ON q.id = aa.question_id
       JOIN topics t ON t.id = q.topic_id
       WHERE q.archived_at IS NULL
         AND qa.completed_at >= now() - $${rangeParamIndex}::interval
         ${classClause}
       GROUP BY t.id, t.title
       ORDER BY t.title ASC`,
      attemptParams
    ),
    // Headline counters. class_average/_recent_7d/_prev_7d power the
    // "Class average" card's trend arrow (this week vs the week before);
    // new_*_7d do the same for the other three cards. Bank totals
    // (questions/quizzes) and their new_*_7d aren't class-scoped -- a
    // question doesn't belong to a class.
    pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'student' ${class_level ? 'AND class_level = $1' : ''})::int AS student_count,
         (SELECT COUNT(*) FROM users WHERE role = 'student' ${class_level ? 'AND class_level = $1' : ''}
            AND created_at >= now() - interval '7 days')::int AS new_students_7d,
         (SELECT COUNT(*) FROM questions WHERE archived_at IS NULL)::int AS question_count,
         (SELECT COUNT(*) FROM questions WHERE archived_at IS NULL
            AND created_at >= now() - interval '7 days')::int AS new_questions_7d,
         (SELECT COUNT(*) FROM quizzes WHERE archived_at IS NULL)::int AS quiz_count,
         (SELECT COUNT(*) FROM quizzes WHERE archived_at IS NULL
            AND created_at >= now() - interval '7 days')::int AS new_quizzes_7d,
         (SELECT ROUND(AVG(qa.score)) FROM quiz_attempts qa JOIN users u ON u.id = qa.student_id
            WHERE qa.completed_at >= now() - $${class_level ? 2 : 1}::interval ${classClause}
         ) AS class_average,
         (SELECT ROUND(AVG(qa.score)) FROM quiz_attempts qa JOIN users u ON u.id = qa.student_id
            WHERE qa.completed_at >= now() - interval '7 days' ${classClause}
         ) AS class_average_recent_7d,
         (SELECT ROUND(AVG(qa.score)) FROM quiz_attempts qa JOIN users u ON u.id = qa.student_id
            WHERE qa.completed_at >= now() - interval '14 days'
              AND qa.completed_at < now() - interval '7 days' ${classClause}
         ) AS class_average_prev_7d`,
      class_level ? [class_level, rangeInterval] : [rangeInterval]
    ),
    // Leaderboard for the dashboard's side panel.
    pool.query(
      `SELECT u.id, u.full_name,
              COUNT(qa.id)::int AS attempts_count,
              ROUND(AVG(qa.score)) AS avg_score
       FROM users u
       JOIN quiz_attempts qa
         ON qa.student_id = u.id AND qa.completed_at >= now() - $${rangeParamIndex}::interval
       WHERE u.role = 'student'
         ${classClause}
       GROUP BY u.id, u.full_name
       ORDER BY attempts_count DESC
       LIMIT 5`,
      attemptParams
    ),
    // Question bank composition by difficulty, for the dashboard's donut
    // chart -- e.g. a bank that's skewed too easy/hard is worth knowing.
    // Bank-wide: not scoped to class/range.
    pool.query(
      `SELECT difficulty, COUNT(*)::int AS count
       FROM questions WHERE archived_at IS NULL
       GROUP BY difficulty`
    ),
    // Class average per day, last 14 days, for the trend line -- its own
    // fixed window regardless of the range filter (the card is explicitly
    // labeled "Last 14 days"), but still respects the class filter. Days
    // with no completed attempts simply don't appear (a gap, not a zero)
    // -- the frontend already treats "fewer than 2 points" as "not enough
    // data yet", same as the per-student trend chart.
    pool.query(
      `SELECT DATE(qa.completed_at) AS day, ROUND(AVG(qa.score)) AS avg_score
       FROM quiz_attempts qa
       JOIN users u ON u.id = qa.student_id
       WHERE qa.completed_at >= now() - interval '14 days'
         ${classClause}
       GROUP BY DATE(qa.completed_at)
       ORDER BY day ASC`,
      classParams
    ),
    // Powers the class filter dropdown.
    pool.query(
      `SELECT DISTINCT class_level FROM users
       WHERE role = 'student' AND archived_at IS NULL AND class_level IS NOT NULL
       ORDER BY class_level`
    ),
  ]);

  const topics = topicRes.rows.map((t) => ({
    topic_id: t.topic_id,
    topic_title: t.topic_title,
    answered: t.answered,
    correct: t.correct,
    accuracy: t.answered ? Math.round((t.correct / t.answered) * 100) : 0,
  }));

  const totals = totalsRes.rows[0];
  const num = (v) => (v === null ? null : Number(v));

  res.json({
    totals: {
      students: totals.student_count,
      new_students_7d: totals.new_students_7d,
      questions: totals.question_count,
      new_questions_7d: totals.new_questions_7d,
      quizzes: totals.quiz_count,
      new_quizzes_7d: totals.new_quizzes_7d,
      class_average: num(totals.class_average),
      class_average_recent_7d: num(totals.class_average_recent_7d),
      class_average_prev_7d: num(totals.class_average_prev_7d),
    },
    available_classes: classesRes.rows.map((r) => r.class_level),
    // Weakest first: that ordering is the whole point of the chart.
    topics: [...topics].sort((a, b) => a.accuracy - b.accuracy),
    weak_topics: topics
      .filter((t) => t.answered >= 3)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5),
    most_active: activeRes.rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      attempts_count: r.attempts_count,
      avg_score: r.avg_score === null ? null : Number(r.avg_score),
    })),
    difficulty_mix: ['easy', 'medium', 'hard'].map((label, i) => ({
      label,
      count: difficultyRes.rows.find((r) => r.difficulty === i + 1)?.count || 0,
    })),
    score_trend: trendRes.rows.map((r) => ({
      day: r.day,
      avg_score: Number(r.avg_score),
    })),
  });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load class summary' });
  }
}

module.exports = { studentDetail, classSummary };

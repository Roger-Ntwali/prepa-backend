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
        `SELECT qa.id, qz.title AS quiz_title, qa.score, qa.completed_at
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
  const [topicRes, totalsRes, activeRes, difficultyRes, trendRes] = await Promise.all([
    // Accuracy per topic across every student.
    pool.query(
      `SELECT
         t.id AS topic_id, t.title AS topic_title,
         COUNT(aa.id)::int AS answered,
         COUNT(aa.id) FILTER (WHERE aa.is_correct)::int AS correct
       FROM attempt_answers aa
       JOIN quiz_attempts qa ON qa.id = aa.attempt_id
       JOIN questions q ON q.id = aa.question_id
       JOIN topics t ON t.id = q.topic_id
       WHERE q.archived_at IS NULL
       GROUP BY t.id, t.title
       ORDER BY t.title ASC`
    ),
    // Headline counters, each a cheap COUNT.
    pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'student')::int AS student_count,
         (SELECT COUNT(*) FROM questions WHERE archived_at IS NULL)::int AS question_count,
         (SELECT COUNT(*) FROM quizzes WHERE archived_at IS NULL)::int AS quiz_count,
         (SELECT ROUND(AVG(score)) FROM quiz_attempts
            WHERE completed_at IS NOT NULL) AS class_average`
    ),
    // Leaderboard for the dashboard's side panel.
    pool.query(
      `SELECT u.id, u.full_name,
              COUNT(qa.id)::int AS attempts_count,
              ROUND(AVG(qa.score)) AS avg_score
       FROM users u
       JOIN quiz_attempts qa
         ON qa.student_id = u.id AND qa.completed_at IS NOT NULL
       WHERE u.role = 'student'
       GROUP BY u.id, u.full_name
       ORDER BY attempts_count DESC
       LIMIT 5`
    ),
    // Question bank composition by difficulty, for the dashboard's donut
    // chart -- e.g. a bank that's skewed too easy/hard is worth knowing.
    pool.query(
      `SELECT difficulty, COUNT(*)::int AS count
       FROM questions WHERE archived_at IS NULL
       GROUP BY difficulty`
    ),
    // Class average per day, last 14 days, for the trend line. Days with
    // no completed attempts simply don't appear (a gap, not a zero) --
    // the frontend already treats "fewer than 2 points" as "not enough
    // data yet", same as the per-student trend chart.
    pool.query(
      `SELECT DATE(completed_at) AS day, ROUND(AVG(score)) AS avg_score
       FROM quiz_attempts
       WHERE completed_at IS NOT NULL AND completed_at >= now() - interval '14 days'
       GROUP BY DATE(completed_at)
       ORDER BY day ASC`
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

  res.json({
    totals: {
      students: totals.student_count,
      questions: totals.question_count,
      quizzes: totals.quiz_count,
      class_average:
        totals.class_average === null ? null : Number(totals.class_average),
    },
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

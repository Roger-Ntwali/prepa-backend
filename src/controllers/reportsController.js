const pool = require('../config/db');

// Per-student detail: accuracy by topic (to surface weak areas) plus a
// simple attempt history, for the admin/teacher dashboard's student view.
async function studentDetail(req, res) {
  const { id } = req.params;

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
}

module.exports = { studentDetail };

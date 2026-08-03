// The `questions` table stores options as {"A":"...","B":"...","C":"...","D":"..."}
// and correct_answer as a letter (A/B/C/D) — natural for storage and for
// the CSV importer/AI generator. The Flutter app's Question model instead
// expects `options` as a plain ordered list of option strings and
// `correct_answer` as the literal text of the correct one (matching how
// offline demo content is shaped). This function bridges the two so every
// endpoint the app calls returns data it can actually parse.
function toAppShape(row) {
  const options = row.options || {};
  const letters = ['A', 'B', 'C', 'D'].filter((l) => options[l] !== undefined);
  const optionList = letters.map((l) => options[l]);
  const correctText = options[row.correct_answer] ?? row.correct_answer;
  const difficultyWord =
    row.difficulty === 1 ? 'easy' : row.difficulty === 3 ? 'hard' : 'medium';

  return {
    id: row.id,
    topic_id: row.topic_id,
    past_paper_id: row.past_paper_id,
    text: row.question_text,
    options: optionList,
    correct_answer: correctText,
    explanation: row.explanation,
    difficulty: difficultyWord,
    // Portal-only (the quiz builder's question picker uses this to flag
    // questions already assigned elsewhere); harmless extra field for the
    // mobile app, which doesn't look for it. Only listQuestions' query
    // actually joins quiz_questions, so this is [] everywhere else.
    used_in_quizzes: row.used_in_quizzes || [],
  };
}

module.exports = { toAppShape };

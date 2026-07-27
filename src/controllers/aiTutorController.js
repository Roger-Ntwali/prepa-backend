const pool = require('../config/db');
const { callGemini, PLAIN_TEXT_STYLE_RULES } = require('../utils/gemini');

const SYSTEM_PROMPT = `You are the PREPA AI Tutor, helping Rwandan Senior 3 students prepare
for the REB O-Level Biology national exam. Explain concepts clearly and simply,
use REB curriculum terminology, keep answers focused and exam-relevant, and
end with a short follow-up practice question when appropriate. Explain in a
bilingual Kinyarwanda/English style, as already established with students.

${PLAIN_TEXT_STYLE_RULES}`;

async function ask(req, res) {
  // The app sends { question, topic_id, history }; earlier testing used
  // { prompt, topic_id, question_id } directly against this endpoint.
  // Accept both so neither breaks.
  const { prompt, question, topic_id, question_id, history } = req.body;
  const userMessage = prompt || question;
  if (!userMessage) return res.status(400).json({ error: 'question (or prompt) is required' });

  try {
    const historyText = Array.isArray(history) && history.length
      ? '\n\nConversation so far:\n' + history.map((h) => `${h.role === 'assistant' ? 'Tutor' : 'Student'}: ${h.content}`).join('\n')
      : '';

    const responseText = await callGemini(
      `${SYSTEM_PROMPT}${historyText}\n\nStudent's question: ${userMessage}`,
      { maxOutputTokens: 2000, temperature: 0.4 }
    );

    await pool.query(
      `INSERT INTO ai_tutor_sessions (student_id, topic_id, question_id, prompt, response)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.user.id, topic_id || null, question_id || null, userMessage, responseText]
    );

    // Return both keys — 'response' for direct API testing, 'reply' for
    // the app's ApiClient.aiTutor(), which reads data['reply'].
    res.json({ response: responseText, reply: responseText });
  } catch (err) {
    if (err.isConfigError) {
      return res.status(503).json({ error: 'AI tutoring is not configured on this server (missing GEMINI_API_KEY)' });
    }
    console.error(err);
    res.status(502).json({ error: 'AI tutor request failed', detail: err.message });
  }
}

module.exports = { ask };

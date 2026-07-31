const pool = require('../config/db');
const { callGemini, TUTOR_SYSTEM_PROMPT } = require('../utils/gemini');

// Longer than this and the prompt was resending the entire chat history on
// every turn -- more tokens in means more time for Gemini to process before
// the first output token, on top of the network latency fixed in gemini.js.
// 10 messages is enough context for the conversation to stay coherent
// without that cost growing unbounded as a chat gets longer.
const MAX_HISTORY_MESSAGES = 10;

async function ask(req, res) {
  // The app sends { question, topic_id, history }; earlier testing used
  // { prompt, topic_id, question_id } directly against this endpoint.
  // Accept both so neither breaks.
  const { prompt, question, topic_id, question_id, history } = req.body;
  const userMessage = prompt || question;
  if (!userMessage) return res.status(400).json({ error: 'question (or prompt) is required' });

  try {
    const recentHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];
    const historyText = recentHistory.length
      ? '\n\nConversation so far:\n' + recentHistory.map((h) => `${h.role === 'assistant' ? 'Tutor' : 'Student'}: ${h.content}`).join('\n')
      : '';

    const responseText = await callGemini(
      `${TUTOR_SYSTEM_PROMPT}${historyText}\n\nStudent's question: ${userMessage}`,
      { maxOutputTokens: 2000, temperature: 0.4 }
    );

    // Return both keys — 'response' for direct API testing, 'reply' for
    // the app's ApiClient.aiTutor(), which reads data['reply']. Sent
    // immediately once Gemini answers -- the session-history write below
    // is real DB latency (measured ~10s on a cold Neon connection) that
    // has no reason to make the student wait, since it's just a log of the
    // conversation, not something the response depends on.
    res.json({ response: responseText, reply: responseText });

    pool
      .query(
        `INSERT INTO ai_tutor_sessions (student_id, topic_id, question_id, prompt, response)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.user.id, topic_id || null, question_id || null, userMessage, responseText]
      )
      .catch((err) => console.error('Failed to log ai_tutor_session:', err));
  } catch (err) {
    if (err.isConfigError) {
      return res.status(503).json({ error: 'AI tutoring is not configured on this server (missing GEMINI_API_KEY)' });
    }
    console.error(err);
    // Gemini's own 429 (quota exceeded) should reach the client as a 429 --
    // the mobile app already shows a dedicated rate-limit message for that
    // status specifically. Everything else without a real upstream status
    // (network failure, JSON parse error) stays a 502, since this server
    // did reach Gemini's API boundary but the call itself failed.
    const status = err.status === 429 ? 429 : 502;
    res.status(status).json({ error: 'AI tutor request failed', detail: err.message });
  }
}

module.exports = { ask };

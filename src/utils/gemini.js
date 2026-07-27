// Thin wrapper around Google's Gemini API (via Google AI Studio), used by
// both the AI tutor and the PDF-to-questions importer. Gemini has a
// genuinely free tier (no credit card, no expiry) which is why this
// project uses it instead of a paid API.
//
// Get a free key at https://aistudio.google.com/apikey and set it as
// GEMINI_API_KEY in .env. GEMINI_MODEL is optional (defaults below).
// Using the 'gemini-flash-latest' alias instead of a pinned version
// (e.g. 'gemini-2.5-flash') means it keeps working automatically as
// Google retires older model versions over time.
//
// `content` can be a plain string (simple text prompt), or an array of
// parts for multimodal input, e.g.:
//   [{ text: '...' }, { inlineData: { mimeType: 'application/pdf', data: base64 } }]
// Sending a PDF this way lets Gemini read it directly (including scanned/
// image-based pages) instead of relying on a text-extraction library that
// only works on PDFs with a proper embedded text layer.
async function callGemini(content, { maxOutputTokens = 4096 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not set in .env');
    err.isConfigError = true;
    throw err;
  }
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const parts = typeof content === 'string' ? [{ text: content }] : content;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        // Not setting thinkingConfig at all: some models reject the field
        // outright (400 invalid argument), others use part of the budget
        // for hidden reasoning. A generous maxOutputTokens covers both
        // cases without needing to know which model this alias resolves to.
        generationConfig: { maxOutputTokens },
      }),
    }
  );

  const data = await res.json();

  if (!res.ok) {
    const message = data?.error?.message || `Gemini API error (status ${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  const candidate = data.candidates && data.candidates[0];
  const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';

  if (!text.trim()) {
    const reason = candidate?.finishReason || 'unknown';
    const err = new Error(`Gemini returned an empty response (finishReason: ${reason}). Try again, or increase maxOutputTokens.`);
    throw err;
  }

  return text;
}

module.exports = { callGemini };

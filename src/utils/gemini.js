// Thin wrapper around Google's Gemini API (via Google AI Studio), used by
// both the AI tutor and the PDF-to-questions importer. Gemini has a
// genuinely free tier (no credit card, no expiry) which is why this
// project uses it instead of a paid API.
//
// Get a free key at https://aistudio.google.com/apikey and set it as
// GEMINI_API_KEY in .env. GEMINI_MODEL is optional (defaults below).
// Using a "-latest" alias instead of a pinned version means it keeps
// working automatically as Google retires older model versions over time.
// Specifically 'gemini-flash-lite-latest', not 'gemini-flash-latest': the
// latter currently resolves to a "thinking" model (confirmed via
// usageMetadata.thoughtsTokenCount, ~644 hidden reasoning tokens per
// reply) that took 6-9s per tutor response with no network cause -- the
// lite alias resolves to a non-thinking variant, ~1.9s for the same
// prompt. Revert if a deployment ever needs the heavier model's answer
// quality more than its speed.

const dns = require('dns');
const { Agent } = require('undici');

// This host needs `--dns-result-order=ipv6first` (set in package.json's
// start/dev scripts) for Neon's Postgres connections to resolve correctly.
// But generativelanguage.googleapis.com over IPv6 times out before falling
// back to IPv4 on this network -- every Gemini call was paying that full
// timeout (measured 10-14s here, reportedly ~60s on the affected machine)
// on top of Gemini's own 2-5s response time.
//
// Fixed with a dedicated undici Agent, scoped to Gemini calls only, that:
//  (a) resolves this one host IPv4-only via a custom `lookup`, sidestepping
//      the IPv6 timeout entirely without touching the global DNS order
//      Neon's connections still need, and
//  (b) pools/reuses the TLS connection across calls (undici Agents keep
//      connections alive by default), so only the very first tutor message
//      pays a fresh handshake -- not every message in a conversation.
function ipv4OnlyLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, family: 4 }, callback);
}

const geminiAgent = new Agent({
  connect: { lookup: ipv4OnlyLookup },
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 60_000,
});

// `content` can be a plain string (simple text prompt), or an array of
// parts for multimodal input, e.g.:
//   [{ text: '...' }, { inlineData: { mimeType: 'application/pdf', data: base64 } }]
// Sending a PDF this way lets Gemini read it directly (including scanned/
// image-based pages) instead of relying on a text-extraction library that
// only works on PDFs with a proper embedded text layer.
async function callGemini(content, { maxOutputTokens = 4096, temperature } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not set in .env');
    err.isConfigError = true;
    throw err;
  }
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const parts = typeof content === 'string' ? [{ text: content }] : content;

  const generationConfig = { maxOutputTokens };
  if (temperature !== undefined) generationConfig.temperature = temperature;

  const handlerStart = Date.now();
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
        generationConfig,
      }),
      dispatcher: geminiAgent,
    }
  );
  const firstByteMs = Date.now() - handlerStart;

  const data = await res.json();
  const totalMs = Date.now() - handlerStart;
  console.log(`[gemini] first-byte: ${firstByteMs}ms, total: ${totalMs}ms, status: ${res.status}`);

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

// Shared formatting rule for every AI Tutor call (chat answers, generated
// practice questions, concept explanations, etc.) — the app's chat bubble
// UI renders plain text only, so markdown syntax shows up as literal
// asterisks/hashes/pipes instead of actual formatting. Centralized here
// so every prompt that builds on top of the tutor persona gets it for
// free instead of repeating it per call site.
const PLAIN_TEXT_STYLE_RULES = `Formatting rules — follow exactly:
- Plain text only. Never use markdown: no **bold**, no ### headings, no bullet
  dashes, no numbered-list symbols, no | table bars, no backticks.
- No filler: skip greetings, "let me know if you need more help", or any
  closing remark beyond the one follow-up question the structure below asks
  for.
- Write in short paragraphs (2-4 sentences each), never a single wall of text
  — this is read in a small mobile chat bubble, and the whole answer should
  be readable in under a minute.`;

// Centralized here (not per-endpoint) so a single edit changes every tutor
// reply consistently. Previously told the model to answer bilingually in
// Kinyarwanda/English, which was the direct cause of students getting
// non-English answers -- REB exams are sat in English only, so tutoring
// answers now are too.
const TUTOR_SYSTEM_PROMPT = `You are the PREPA AI Tutor, helping Rwandan Senior 3 students prepare for
the REB O-Level Biology national exam.

Language: respond in English ONLY, always — students study and sit the exam
in English. If a student writes in Kinyarwanda, or mixes Kinyarwanda into
their question, warmly acknowledge that in one short clause, then teach the
actual answer in clear, simple English (short sentences, everyday
vocabulary). Never answer in Kinyarwanda, and never mix Kinyarwanda into the
explanation itself.

Scope: you only teach O-Level Biology (cells, life processes, human body
systems, genetics, ecology, health and disease, and related REB syllabus
topics). If the student's question is not about Biology — another subject
(Math, Chemistry, Physics, English, etc.), general homework help, personal
advice, or any other off-topic request — do NOT answer it, even partially,
and do not use the 5-step structure below for it. Instead reply with exactly
one short, warm sentence that says you're the Biology tutor and can't help
with that, then invite them to ask a Biology question instead. This scope
rule applies even if the student insists, rephrases, or claims the off-topic
question is "for Biology class."

Structure every Biology answer in exactly this order:
1. One direct sentence that answers the question immediately.
2. A short explanation in plain English, building on that sentence.
3. Exactly one everyday example a Rwandan student would immediately
   recognize — cooking, farming, the weather, the human body, or football
   are reliable choices; pick whichever fits the concept best.
4. Where it fits naturally, tie the point back to what's tested on the
   REB O-Level Biology exam.
5. End with exactly one short follow-up question inviting the student to go
   deeper or try a related practice question.

Tone: warm and encouraging, like a patient tutor who believes in the
student — never curt, never condescending.

${PLAIN_TEXT_STYLE_RULES}`;

module.exports = { callGemini, PLAIN_TEXT_STYLE_RULES, TUTOR_SYSTEM_PROMPT };

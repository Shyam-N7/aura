// Minimal Gemini client. Reads GEMINI_API_KEY from env at first use so the
// server boots even when the key isn't set (lyrics + catalog still work).
// Auto-falls back from gemini-2.5-flash → flash-lite when Flash is throttled
// (503/UNAVAILABLE) so a transient spike doesn't break "Why this".

import { GoogleGenAI } from '@google/genai';

let cachedClient = null;
function client() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY not set in .env.local');
    err.statusCode = 503;
    throw err;
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

function isUnavailable(err) {
  const status = err?.status ?? err?.code;
  if (status === 503 || status === 429 || status === 'UNAVAILABLE' || status === 'RESOURCE_EXHAUSTED') return true;
  const msg = err?.message ?? '';
  // 503 = overloaded; 429 / RESOURCE_EXHAUSTED = quota hit; both should retry on flash-lite.
  return /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|exceeded your current quota|503|429/i.test(msg);
}

function cleanError(err) {
  // The SDK sometimes throws with the full JSON response as `message`. Pull
  // out the human-readable part if we can find one.
  const raw = err?.message ?? String(err);
  try {
    const m = raw.match(/\{[\s\S]*"message"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  } catch { /* fallthrough */ }
  return raw.slice(0, 240);
}

async function callOnce({ ai, model, system, prompt, schema, temperature }) {
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction:   system,
      responseMimeType:    'application/json',
      responseSchema:      schema,
      temperature,
    },
  });
  const text = response.text;
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }
}

/**
 * Call Gemini with a system prompt + user content, expect a JSON response that
 * matches the given schema. Returns the parsed object. Falls back from
 * gemini-2.5-flash → flash-lite once on UNAVAILABLE.
 */
export async function generateJson({
  model = 'gemini-2.5-flash',
  system,
  prompt,
  schema,
  temperature = 0.8,
}) {
  const ai = client();
  try {
    return await callOnce({ ai, model, system, prompt, schema, temperature });
  } catch (err) {
    if (!isUnavailable(err) || model === 'gemini-2.5-flash-lite') {
      const wrapped = new Error(cleanError(err));
      wrapped.statusCode = err?.statusCode ?? 502;
      throw wrapped;
    }
    // Retry once on flash-lite (higher quota, less likely to be throttled).
    try {
      return await callOnce({ ai, model: 'gemini-2.5-flash-lite', system, prompt, schema, temperature });
    } catch (retryErr) {
      const wrapped = new Error(cleanError(retryErr));
      wrapped.statusCode = retryErr?.statusCode ?? 503;
      throw wrapped;
    }
  }
}

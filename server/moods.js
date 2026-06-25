// Canonical mood vocabulary. The mood-inference engine (prompts/moodInfer.js)
// emits the first six; the bridges "ladder" (bridges.js) adds happy/energized.
// Client-supplied mood (greeting, why-this) is validated against this set so an
// attacker can't bypass the per-mood cache with arbitrary strings — each unique
// string would otherwise force a fresh paid Gemini call and a new cache entry.
// Anything unknown collapses to 'any' (a single shared, mood-agnostic entry).
// (security: H1 / #14)
export const MOODS = ['restless', 'focused', 'calm', 'upbeat', 'warm', 'social', 'happy', 'energized'];
const SET = new Set(MOODS);

// Returns a known mood (lowercased) or 'any'.
export function normalizeMood(input) {
  if (typeof input !== 'string') return 'any';
  const m = input.trim().toLowerCase();
  return SET.has(m) ? m : 'any';
}

// Pure intent matcher for hands-free voice (Car Mode). It recognises ONLY the small
// set of deterministic transport verbs that must respond instantly and offline —
// "next", "pause", "louder", "like"… — and maps each to a player action `kind`.
// Anything it doesn't recognise returns null; the caller then sends the raw
// transcript to the /api/llm/talk pipeline, which handles "play <song / vibe>" and
// everything conversational. This is honest command parsing (exact, unambiguous
// control words), NOT a fake on-device brain — the real intelligence stays in the LLM.

function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation so "next!" == "next"
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordered so more-specific phrases win (e.g. "volume up" before bare verbs). Each
// rule is matched as whole words, so "background" never trips the "back" → prev rule.
const PATTERNS = [
  [/\b(louder|volume up|turn (it )?up|crank (it )?up|pump (it )?up)\b/, 'louder'],
  [/\b(softer|quieter|volume down|turn (it )?down|lower the volume)\b/, 'softer'],
  [/\bunmute\b/, 'unmute'],
  [/\bmute\b/, 'mute'],
  [/\b(restart|start over|from the (beginning|top))\b/, 'restart'],
  [/\b(next|skip|forward)\b/, 'next'],
  [/\b(previous|go back|\bback\b|last song|replay)\b/, 'prev'],
  [/\b(pause|stop|halt|hold on)\b/, 'pause'],
  [/\b(shuffle|mix it up|randomi[sz]e)\b/, 'shuffle'],
  [/\b(repeat|loop)\b/, 'repeat'],
  // "like" is constrained to "like this/it/that" — a BARE \blike\b would hijack
  // similarity requests like "songs like coldplay" into a thumbs-up.
  [/\b(like (this|it|that)|favou?rite|love (this|it)|thumbs up)\b/, 'like'],
];

// Bare "resume" commands only — matched as the WHOLE utterance so "play despacito"
// (a search) is NOT caught here and falls through to the LLM.
const RESUME_EXACT = new Set([
  'play', 'resume', 'continue', 'unpause', 'keep playing', 'play it', 'resume playback',
]);

// A request that names something to play/queue is ALWAYS a search → the LLM, never a
// transport command. Without this, a title that happens to contain a control word
// ("play back to december", "play skip to my lou", "play songs like coldplay") would
// be hijacked by the prev/next/like rules. Checked AFTER the bare-resume set so a
// lone "play"/"play it" still resumes.
const REQUEST_PREFIX = /^(play|put on|listen to|queue)\b/;

// Strip a leading request verb ("play", "put on", "listen to", "queue") so the
// voice loader can echo just what the user asked for — "play vaadi pulla vaadi" →
// "vaadi pulla vaadi". Mirrors REQUEST_PREFIX but keeps the original casing for
// display (the LLM still gets the full raw transcript).
export function stripRequestVerb(transcript) {
  return String(transcript ?? '').replace(/^\s*(play|put on|listen to|queue)\b[\s,]*/i, '').trim();
}

// Returns { kind } for a recognised local command, else null (→ route to the LLM).
export function matchLocalIntent(transcript) {
  const s = normalize(transcript);
  if (!s) return null;
  if (RESUME_EXACT.has(s)) return { kind: 'play' };   // bare "play" / "resume" / …
  if (REQUEST_PREFIX.test(s)) return null;            // "play <song / vibe>" → LLM
  for (const [re, kind] of PATTERNS) {
    if (re.test(s)) return { kind };
  }
  return null;
}

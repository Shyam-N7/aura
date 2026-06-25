// Shared prompt-input sanitizer (no DB / no heavy deps, so any prompt module can
// import it). Flattens control characters (newlines, tabs, code point < 0x20 and
// DEL 0x7f) to spaces and caps length, so user-influenced free text — track
// titles/artists, chat messages, mood — can't inject newlines or run long to
// fake an instruction / break out of its slot when spliced into an LLM prompt.
// Defense in depth; the prompts also frame these as data. (security: #5 / #6)
export function flattenForPrompt(s, maxLen = 80) {
  const flattened = Array.from(String(s ?? ''), (ch) => {
    const c = ch.codePointAt(0);
    return c < 0x20 || c === 0x7f ? ' ' : ch;
  }).join('');
  return flattened.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

// Title/artist convenience at the established 80-char cap.
export function sanitizeForPrompt(s) {
  return flattenForPrompt(s, 80);
}

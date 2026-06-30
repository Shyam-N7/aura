// Spoken confirmation (TTS) for hands-free Car Mode — AURA says "Now playing <title>"
// aloud so the user can keep their eyes on the road. Feature-detected over the
// browser's speechSynthesis; a clean no-op where it's unavailable. Each utterance
// cancels any prior/queued one first so a stale confirmation never talks over the
// next turn. Caller decides WHEN to speak (success only) and whether the setting is on.
//
// Honest limitation: this fires from an async resolve (after the voice request comes
// back), i.e. OUTSIDE a user-gesture window. iOS Safari only speaks within a gesture,
// so on iPhone the utterance is silently dropped — the on-screen "Now playing" line is
// the fallback there. Reliable on Android Chrome / desktop.
export function speak(text, { lang } = {}) {
  if (!text) return;
  const synth = typeof window !== 'undefined' && window.speechSynthesis;
  if (!synth) return;
  try {
    synth.cancel();                 // drop any prior/queued utterance first
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    synth.speak(u);
  } catch { /* ignore */ }
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

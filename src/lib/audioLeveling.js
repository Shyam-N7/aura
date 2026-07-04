// Loudness-leveling preference (the "volume leveling" toggle). Mirrors
// audioQuality: a single localStorage-backed source + a pub/sub the audio engine
// subscribes to, so flipping it in Settings takes effect live without a player ref.
// Leveling is volume-composed (lib/loudness measures a track once; the player
// attenuates hot tracks via el.volume) — no Web Audio involved, so it's safe for
// lock-screen/background playback everywhere and defaults ON.

const KEY = 'aura.leveling';
const subs = new Set();

export function getLeveling() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* ignore */ }
  return true;
}

export function setLeveling(on) {
  const next = !!on;
  try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* ignore */ }
  subs.forEach(fn => { try { fn(next); } catch { /* ignore */ } });
}

export function subscribeLeveling(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

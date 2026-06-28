import { isIOS } from './platform';

// Loudness-leveling preference (the "volume leveling" toggle). Mirrors
// audioQuality: a single localStorage-backed source + a pub/sub the audio engine
// subscribes to, so flipping it in Settings takes effect live without a player ref.
// Default ON everywhere EXCEPT iOS — there, tapping Web Audio forfeits lock-screen/
// background playback, so it's opt-in (the toggle says so).

const KEY = 'aura.leveling';
const subs = new Set();

export function getLeveling() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* ignore */ }
  return !isIOS();
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

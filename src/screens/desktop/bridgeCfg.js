import { LANGUAGES } from '../../data/languages';

// Bridge builder vocabulary + persisted config. Two DIFFERENT, plain word sets
// (each maps to a server MOOD_QUERIES bucket): "where you are" (a current
// feeling) and "where you want to be" (the goal). Colours tint the selected
// chip + the bridge arc.
export const FROM_MOODS = [
  { key: 'sad',      hint: 'low, heavy',   color: '#5a6b9a' },
  { key: 'stressed', hint: 'wound up',     color: '#a85a5a' },
  { key: 'restless', hint: 'antsy, wired', color: '#c2603a' },
  { key: 'tired',    hint: 'drained',      color: '#7a6f8a' },
  { key: 'lonely',   hint: 'on your own',  color: '#5a7a8a' },
];
export const TO_MOODS = [
  { key: 'happy',     hint: 'lifted',      color: '#d8956a' },
  { key: 'calm',      hint: 'at ease',     color: '#5a8a72' },
  { key: 'focused',   hint: 'locked in',   color: '#6e85a3' },
  { key: 'energized', hint: 'fired up',    color: '#c47554' },
  { key: 'social',    hint: 'out, lively', color: '#a8556a' },
];
export const BRIDGE_LANGS = LANGUAGES;
export const MIN_STEPS = 4;
export const MAX_STEPS = 8;

const FROM_KEYS = FROM_MOODS.map(m => m.key);
const TO_KEYS   = TO_MOODS.map(m => m.key);
const KEY = 'aura.moodBridge';

// Last configured bridge persists per-device like the other aura.* prefs. The
// saved keys are validated against the CURRENT vocabulary — a cfg saved before
// the mood words changed would otherwise send an invalid mood to the server
// and 400 with "unknown mood". `langs: []` means "your mix" (the server
// resolves it from listening affinity); legacy {from,to,steps} blobs migrate
// by gaining the empty list.
export function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && c.steps && FROM_KEYS.includes(c.from) && TO_KEYS.includes(c.to)) {
      const langs = Array.isArray(c.langs)
        ? c.langs.filter(l => BRIDGE_LANGS.includes(l)).slice(0, 2)
        : [];
      const steps = Math.min(MAX_STEPS, Math.max(MIN_STEPS, Number(c.steps) || 5));
      return { from: c.from, to: c.to, steps, langs };
    }
  } catch { /* ignore */ }
  return { from: 'sad', to: 'happy', steps: 5, langs: [] };
}

export function saveCfg(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); }
  catch { /* localStorage disabled — non-fatal */ }
}

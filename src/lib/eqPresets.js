// User-saved equalizer presets — the curves a listener dials in and names
// themselves, stored alongside (never replacing) the fixed mood presets in
// audio/eqConfig.js. Same get/set/subscribe shape as lib/audioQuality.js +
// lib/consent.js. Every curve is run through the engine's own sanitizeGains, so
// a corrupt store can never feed a bad curve into the Web Audio graph.

import { sanitizeGains } from '../audio/eqConfig';

const KEY = 'aura.eq.userPresets';
export const MAX_PRESETS = 20;
export const MAX_NAME = 32;
const subs = new Set();

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Coerce an arbitrary stored entry into a valid preset, or null if it's junk.
function normalizePreset(p) {
  const name = String(p?.name ?? '').trim().slice(0, MAX_NAME);
  if (!name || !Array.isArray(p?.gains)) return null;
  return { id: String(p.id ?? makeId()), name, gains: sanitizeGains(p.gains) };
}

export function getEqUserPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizePreset).filter(Boolean).slice(0, MAX_PRESETS);
  } catch {
    return [];   // corrupt JSON / localStorage disabled
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* disabled — non-fatal */ }
  for (const cb of subs) cb(list);
}

// Save the current curve under a name. Returns the new list, or null when the
// name is blank, a case-insensitive duplicate, or the cap is reached — the UI
// checks those up front for specific messaging; this enforces them defensively.
export function saveEqUserPreset(name, gains) {
  const clean = String(name ?? '').trim().slice(0, MAX_NAME);
  if (!clean) return null;
  const list = getEqUserPresets();
  if (list.length >= MAX_PRESETS) return null;
  if (list.some(p => p.name.toLowerCase() === clean.toLowerCase())) return null;
  const next = [...list, { id: makeId(), name: clean, gains: sanitizeGains(gains) }];
  write(next);
  return next;
}

export function deleteEqUserPreset(id) {
  const next = getEqUserPresets().filter(p => p.id !== id);
  write(next);
  return next;
}

export function subscribeEqUserPresets(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

// LocalStorage wrapper for the onboarding state. Four keys:
//   aura.hasOnboarded   — '1' once the user finishes the pick-3 flow.
//   aura.seedArtists    — JSON array of `{ name, language?, sampleTrackId? }`.
//   aura.seedLanguages  — JSON array of language strings the user picked.
//   aura.seedMood       — string mood label, or null if skipped.

import { updatePreferences } from './auth';

const FLAG_KEY  = 'aura.hasOnboarded';
const SEEDS_KEY = 'aura.seedArtists';
const LANGS_KEY = 'aura.seedLanguages';
const MOOD_KEY  = 'aura.seedMood';

export function hasOnboarded() {
  try { return localStorage.getItem(FLAG_KEY) === '1'; }
  catch { return false; }
}

export function markOnboarded() {
  try { localStorage.setItem(FLAG_KEY, '1'); } catch { /* ignore */ }
  // Push the snapshot to the server so a returning user (new device, cleared
  // storage) keeps their seeds. Fire-and-forget — onboarding never blocks on
  // the network, and the local copy is the source of truth meanwhile.
  const { languages, mood } = getSeedSignals();
  updatePreferences({
    hasOnboarded:  true,
    seedArtists:   getSeedArtists(),
    seedLanguages: languages,
    seedMood:      mood,
  }).catch(() => { /* offline / unauthenticated — local copy still holds */ });
}

export function resetOnboarded() {
  try {
    localStorage.removeItem(FLAG_KEY);
    localStorage.removeItem(SEEDS_KEY);
    localStorage.removeItem(LANGS_KEY);
    localStorage.removeItem(MOOD_KEY);
  } catch { /* ignore */ }
  updatePreferences({ hasOnboarded: false, seedArtists: [], seedLanguages: [], seedMood: null })
    .catch(() => { /* best-effort */ });
}

export function getSeedArtists() {
  try {
    const raw = localStorage.getItem(SEEDS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function setSeedArtists(arr) {
  try { localStorage.setItem(SEEDS_KEY, JSON.stringify(arr ?? [])); }
  catch { /* ignore */ }
}

// Language + mood signals captured during onboarding. Stored separately so
// individual sections can be cleared without dropping the artist picks.
export function getSeedSignals() {
  try {
    const langsRaw = localStorage.getItem(LANGS_KEY);
    const langs = langsRaw ? JSON.parse(langsRaw) : [];
    const mood = localStorage.getItem(MOOD_KEY);
    return {
      languages: Array.isArray(langs) ? langs : [],
      mood: mood && mood.length ? mood : null,
    };
  } catch {
    return { languages: [], mood: null };
  }
}

export function setSeedSignals({ languages, mood } = {}) {
  try {
    localStorage.setItem(LANGS_KEY, JSON.stringify(Array.isArray(languages) ? languages : []));
    if (mood) localStorage.setItem(MOOD_KEY, String(mood));
    else      localStorage.removeItem(MOOD_KEY);
  } catch { /* ignore */ }
}

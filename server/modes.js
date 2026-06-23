// Listening modes — switchable contexts, the single source of truth shared by
// featured.js / related.js / app.js / auth.js. NO genre-keyword tricks: each mode
// is seeded by REAL artists whose provider stations define its starting vibe, and
// the user's own per-mode plays take over from there (Phase 2). `everyday` carries
// no seed and falls back to the default global featured, so the default UX is
// unchanged.
//
// seedArtists are plain catalog artist names (resolved live via the catalog
// search the rest of the app already uses) — deliberately a small, tunable
// starting set, not a fixed taxonomy.

export const PRESETS = [
  { key: 'everyday', label: 'Everyday', icon: 'sparkle', seedArtists: [], explicitOff: false, lockable: false },
  { key: 'family',   label: 'Family',   icon: 'home',    seedArtists: ['A.R. Rahman', 'Shreya Ghoshal', 'Sonu Nigam'],                explicitOff: true,  lockable: true },
  { key: 'kids',     label: 'Kids',     icon: 'star',    seedArtists: ['ChuChu TV', 'Infobells', 'Cocomelon'],                        explicitOff: true,  lockable: true },
  { key: 'bhakti',   label: 'Bhakti',   icon: 'lotus',   seedArtists: ['M.S. Subbulakshmi', 'K.J. Yesudas', 'Anuradha Paudwal'],      explicitOff: true,  lockable: false },
  { key: 'trip',     label: 'Trip',     icon: 'car',     seedArtists: ['Anirudh Ravichander', 'Yuvan Shankar Raja', 'Badshah'],       explicitOff: false, lockable: false },
  { key: 'focus',    label: 'Focus',    icon: 'moon',    seedArtists: ['Ludovico Einaudi', 'Yiruma', 'Sid Sriram'],                   explicitOff: false, lockable: false },
];

export const MODE_KEYS = PRESETS.map((p) => p.key);
const BY_KEY = Object.fromEntries(PRESETS.map((p) => [p.key, p]));

export function isModeKey(key) { return Object.prototype.hasOwnProperty.call(BY_KEY, key); }
export function getPreset(key) { return BY_KEY[key] ?? BY_KEY.everyday; }

// The mode's starting seed artists (Phase 2 will blend in learned + borrowed).
export function modeSeedArtists(key) { return getPreset(key).seedArtists; }

// Whether explicit content is hidden in this mode: kids is always clean; otherwise
// the per-mode override (if set) wins over the preset default.
export function effectiveExplicitOff(modesState, key) {
  const preset = getPreset(key);
  if (preset.key === 'kids') return true;
  const st = modesState?.[key];
  return typeof st?.explicitOff === 'boolean' ? st.explicitOff : preset.explicitOff;
}

// Client-safe view: every preset + per-mode { locked, explicitOff }. NEVER leaks
// the PIN hash.
export function buildModesView(modesState = {}) {
  return PRESETS.map((p) => {
    const st = modesState?.[p.key] ?? {};
    return {
      key: p.key,
      label: p.label,
      icon: p.icon,
      lockable: p.lockable,
      locked: !!st.pinHash,
      explicitOff: effectiveExplicitOff(modesState, p.key),
    };
  });
}

// Listening modes — switchable contexts, the single source of truth shared by
// featured.js / related.js / app.js / auth.js. NO genre-keyword tricks: each mode
// is seeded by REAL catalog tracks whose provider STATIONS (the same song-radio
// similarity graph the player uses) define its starting vibe, and the user's own
// per-mode plays take over from there (Phase 2). `everyday` carries no seed and
// falls back to the default global featured, so the default UX is unchanged.
//
// seedTracks are the PRIMARY seed — each is a real catalog track id (with the
// language it stations in, and a human label so the seed is auditable). Stationing
// a track returns genuinely similar songs, so e.g. a devotional track yields
// devotional neighbours and a film track yields film — which is why we seed by
// representative *tracks*, not artist names (a playback singer's name search
// returns their film work, not the mode's vibe). The ids were picked + validated
// against the live station graph (multi-language coverage per mode).
//
// seedArtists are the FALLBACK only — a plain artist-name search used if every
// seed track's station comes back empty (e.g. an id is pulled upstream).

export const PRESETS = [
  { key: 'everyday', label: 'Everyday', icon: 'sparkle', explicitOff: false, lockable: false,
    seedTracks: [], seedArtists: [] },
  { key: 'family', label: 'Family', icon: 'home', explicitOff: true, lockable: true,
    seedTracks: [
      { id: '1yBS8tfM', lang: 'tamil', label: 'Chinna Chinna Asai' },
      { id: 'aRZbUYD7', lang: 'hindi', label: 'Tum Hi Ho' },
    ],
    seedArtists: ['A.R. Rahman', 'Shreya Ghoshal', 'Sonu Nigam'] },
  { key: 'kids', label: 'Kids', icon: 'star', explicitOff: true, lockable: true,
    seedTracks: [
      { id: 'qGm5OFo8', lang: 'english', label: 'Wheels on the Bus' },
      { id: 'Gwwd32aI', lang: 'hindi', label: 'Johny Johny Yes Papa' },
    ],
    seedArtists: ['ChuChu TV', 'Cocomelon', 'Infobells'] },
  { key: 'bhakti', label: 'Bhakti', icon: 'lotus', explicitOff: true, lockable: false,
    seedTracks: [
      { id: 'vL0fWI1r', lang: 'sanskrit', label: 'Vishnu Sahasranamam' },
      { id: '6S6Vll7Q', lang: 'hindi', label: 'Hanuman Chalisa' },
      { id: 'O5OPp0Sa', lang: 'telugu', label: 'Om Namah Shivaya' },
    ],
    seedArtists: ['M.S. Subbulakshmi', 'Anup Jalota', 'Hariharan'] },
  { key: 'trip', label: 'Trip', icon: 'car', explicitOff: false, lockable: false,
    seedTracks: [
      { id: 'AgeRwxTb', lang: 'tamil', label: 'Arabic Kuthu' },
      { id: 'oK1NKyCm', lang: 'hindi', label: 'Kala Chashma' },
    ],
    seedArtists: ['Anirudh Ravichander', 'Yuvan Shankar Raja', 'Badshah'] },
  { key: 'focus', label: 'Focus', icon: 'moon', explicitOff: false, lockable: false,
    seedTracks: [
      { id: 'qtQWu2CF', lang: 'hindi', label: 'Hariprasad Chaurasia (flute)' },
      { id: 'YL10e0rv', lang: 'tamil', label: 'Sad Love BGM' },
      { id: 'P3rRobMI', lang: 'english', label: 'River Flows in You' },
    ],
    seedArtists: ['Ludovico Einaudi', 'Yiruma', 'Hariprasad Chaurasia'] },
];

export const MODE_KEYS = PRESETS.map((p) => p.key);
const BY_KEY = Object.fromEntries(PRESETS.map((p) => [p.key, p]));

export function isModeKey(key) { return Object.prototype.hasOwnProperty.call(BY_KEY, key); }
export function getPreset(key) { return BY_KEY[key] ?? BY_KEY.everyday; }

// The mode's starting seed tracks (primary) + artists (fallback). Phase 2 will
// blend in learned + borrowed seeds.
export function modeSeedTracks(key) { return getPreset(key).seedTracks ?? []; }
export function modeSeedArtists(key) { return getPreset(key).seedArtists ?? []; }

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

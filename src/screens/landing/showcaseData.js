// Curated, static data for the landing-page feature spotlights. Everything here
// is invented/placeholder so the showcases render the REAL app components with
// zero auth / API / audio. Covers are inline data-URI SVG gradients so there are
// no bundled binaries and no copyrighted art.

export function cover(a, b) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>` +
    `</linearGradient></defs><rect width='96' height='96' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Bridge journeys — each renders the real <BridgeItinerary>. `tracks` carry the
// album-art rung (imageUrl) + one-word stage label; `narrative` is the line the
// LLM would normally write. Shapes match what the bridges screen builds live.
const T = (id, title, artist, c1, c2, stepLabel) => ({
  id, title, artist, imageUrl: cover(c1, c2), stepLabel, durationSec: 180 + (id.length % 5) * 14,
});

export const BRIDGE_PRESETS = [
  {
    id: 'lp-br1', from: 'sad', to: 'happy', steps: 5, ETA: '18 min',
    narrative: 'a slow climb out of the low — soft starts, then light creeping back in.',
    tracks: [
      T('lpb1a', 'Paper Boats', 'Maya Reed',      '#5a6b9a', '#6b6f9a', 'low'),
      T('lpb1b', 'Slow Tide',   'Leo Hart',       '#6b6f9a', '#8a7a8e', 'easing'),
      T('lpb1c', 'Half Light',  'Nina Cole',      '#8a7a8e', '#b08a6a', 'lifting'),
      T('lpb1d', 'Open Window', 'Sol Avery',      '#b08a6a', '#cf9460', 'warmer'),
      T('lpb1e', 'Bright Side', 'The Lamplights', '#cf9460', '#d8956a', 'bright'),
    ],
  },
  {
    id: 'lp-br2', from: 'stressed', to: 'calm', steps: 6, ETA: '24 min',
    narrative: 'letting the day loosen its grip, one quieter song at a time.',
    tracks: [
      T('lpb2a', 'Tight Rope',   'Aria Vance',  '#a85a5a', '#9a5a66', 'tense'),
      T('lpb2b', 'Long Exhale',  'Maya Reed',   '#9a5a66', '#7a5a78', 'easing'),
      T('lpb2c', 'Lower Lights', 'Nina Cole',   '#7a5a78', '#6a6a82', 'slower'),
      T('lpb2d', 'Still Water',  'Leo Hart',    '#6a6a82', '#5e7a84', 'softer'),
      T('lpb2e', 'Driftwood',    'Sol Avery',   '#5e7a84', '#5a8a7e', 'drift'),
      T('lpb2f', 'Quiet Room',   'June Mori',   '#5a8a7e', '#5a8a72', 'still'),
    ],
  },
  {
    id: 'lp-br3', from: 'tired', to: 'energized', steps: 4, ETA: '15 min',
    narrative: 'easing you awake, then handing over the momentum.',
    tracks: [
      T('lpb3a', 'First Light',  'June Mori',      '#7a6f8a', '#a06f7a', 'heavy'),
      T('lpb3b', 'Kettle On',    'The Lamplights', '#a06f7a', '#bf6f60', 'waking'),
      T('lpb3c', 'Uphill',       'Sol Avery',      '#bf6f60', '#c47554', 'rising'),
      T('lpb3d', 'Full Speed',   'Aria Vance',     '#c47554', '#d88a4a', 'charged'),
    ],
  },
  {
    id: 'lp-br4', from: 'restless', to: 'focused', steps: 4, ETA: '13 min',
    narrative: 'trading the jitter for a single, steady line of attention.',
    tracks: [
      T('lpb4a', 'Static',     'Aria Vance', '#c2603a', '#a0664a', 'edgy'),
      T('lpb4b', 'Narrowing',  'Leo Hart',   '#a0664a', '#86766e', 'narrow'),
      T('lpb4c', 'One Thread', 'Nina Cole',  '#86766e', '#6e85a3', 'steady'),
      T('lpb4d', 'Deep Work',  'Maya Reed',  '#6e85a3', '#6e85a3', 'locked'),
    ],
  },
];

// Cinematic-lyrics demo — original placeholder lyric, no copyrighted text.
export const LYRIC_DEMO = {
  title: 'Amber Hours',
  artist: 'Maya Reed',
  cover: ['#3a2b6b', '#b06a3f'],
  durationSec: 54,
  lines: [
    { t: 0,  line: 'the streetlights blur into amber' },
    { t: 6,  line: 'and the city forgets to breathe' },
    { t: 12, line: 'i am driving nowhere slowly' },
    { t: 19, line: 'with the windows letting in the night' },
    { t: 27, line: 'every song you ever gave me' },
    { t: 34, line: 'plays a little softer now' },
    { t: 41, line: 'so i let the quiet hold me' },
    { t: 48, line: 'until the morning finds me out' },
  ],
};

// A small "now playing" card used inside the Themes spotlight to show real
// tokens re-theming live.
export const THEME_DEMO_TRACK = {
  title: 'Open Window',
  artist: 'Leo Hart',
  cover: ['#6b4a2b', '#e8b87a'],
};

// Quick-picks orbit — the real <QuickPicksOrbit> renders these as orbiting discs.
export const ORBIT_TRACKS = [
  { id: 'orb1', title: 'Sunset Drive', artist: 'Maya Reed',       imageUrl: cover('#b8a4ff', '#3a2b6b') },
  { id: 'orb2', title: 'Open Window',  artist: 'Leo Hart',        imageUrl: cover('#6b4a2b', '#e8b87a') },
  { id: 'orb3', title: 'Slow Morning', artist: 'Nina Cole',       imageUrl: cover('#a8d8b0', '#2f5b42') },
  { id: 'orb4', title: 'Paper Boats',  artist: 'Sol Avery',       imageUrl: cover('#5a6b9a', '#8a7a8e') },
  { id: 'orb5', title: 'First Light',  artist: 'June Mori',        imageUrl: cover('#c47554', '#d88a4a') },
  { id: 'orb6', title: 'Quiet Room',   artist: 'The Lamplights',  imageUrl: cover('#5a8a7e', '#5a8a72') },
];

// Mood-sensing replays cycle through the inference moods.
export const SENSING_MOODS = ['ready', 'calm', 'focused', 'upbeat', 'warm'];

// Player spotlight — driven by a SimulatedAudioPlayer (no real audio).
export const PLAYER_TRACKS = [
  { id: 'pl1', title: 'Amber Hours',  artist: 'Maya Reed', durationSec: 214, imageUrl: cover('#3a2b6b', '#b06a3f') },
  { id: 'pl2', title: 'Open Window',  artist: 'Leo Hart',  durationSec: 188, imageUrl: cover('#6b4a2b', '#e8b87a') },
  { id: 'pl3', title: 'Slow Morning', artist: 'Nina Cole', durationSec: 232, imageUrl: cover('#a8d8b0', '#2f5b42') },
];

// Talk-to-AURA — scripted replies so the chat is interactive without the API.
export const TALK_SUGGESTIONS = [
  'take me somewhere quieter',
  'i need to focus',
  'something with more weight',
  'play tamil indie',
];
export const TALK_SCRIPT = {
  'take me somewhere quieter': 'got it. easing things down — softer textures, longer gaps between tracks.',
  'i need to focus': 'locking in. steady tempo, no big drops, nothing pulling at your attention.',
  'something with more weight': 'turning it up — heavier low end, more drive. hold on.',
  'play tamil indie': 'pulling a tamil indie set — dreamy, a little restless. starting now.',
};
export const TALK_DEFAULT_REPLY = "on it — reshaping the queue around that. tell me if it's not quite right.";

// Hash-based route serializer. Layered on top of App.jsx's setScreen state
// machine — these helpers don't own state, they just translate between
// `{ screen, artistKey, detailPlaylistId, catalogPlaylistId, hubLang }` and a
// hash like `#/artist/abc123`.
//
// Why hash routing and not pushState paths: the app is single-page and we
// don't want the Vite/Express server to need new routes for `/artist/:id`
// etc. Hash works everywhere with zero server changes.

// Routes that don't take a parameter — direct map.
const SIMPLE = {
  '/':            { screen: 'home' },
  '/home':        { screen: 'home' },
  '/search':      { screen: 'search' },
  '/library':     { screen: 'library' },
  '/liked':       { screen: 'liked' },
  '/playlists':   { screen: 'playlists' },
  '/journal':     { screen: 'journal' },
  '/dna':         { screen: 'dna' },
  '/bridges':     { screen: 'bridges' },
  '/talk':        { screen: 'talk' },
  '/queue':       { screen: 'queue' },
  '/player':      { screen: 'player' },
  '/onboarding':  { screen: 'onboarding' },
};

// Reverse map for buildHash — screen name → simple path.
const SIMPLE_REVERSE = {
  home: '/',
  search: '/search',
  library: '/library',
  liked: '/liked',
  playlists: '/playlists',
  journal: '/journal',
  dna: '/dna',
  bridges: '/bridges',
  talk: '/talk',
  queue: '/queue',
  player: '/player',
  onboarding: '/onboarding',
};

// parseHash('#/artist/abc123') → { screen: 'artist', artistKey: { id: 'abc123' } }
export function parseHash(hash) {
  if (!hash || hash === '#' || hash === '#/') return { screen: 'home' };
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  const simple = SIMPLE[path];
  if (simple) return { ...simple };

  // /playlist/:id
  let m;
  if ((m = path.match(/^\/playlist\/(.+)$/))) {
    return { screen: 'playlist-detail', detailPlaylistId: decodeURIComponent(m[1]) };
  }
  if ((m = path.match(/^\/catalog\/(.+)$/))) {
    return { screen: 'catalog-playlist-detail', catalogPlaylistId: decodeURIComponent(m[1]) };
  }
  if ((m = path.match(/^\/lang\/(.+)$/))) {
    return { screen: 'language-hub', hubLang: decodeURIComponent(m[1]) };
  }
  if ((m = path.match(/^\/artist\/by-name\/(.+)$/))) {
    return { screen: 'artist', artistKey: { name: decodeURIComponent(m[1]) } };
  }
  if ((m = path.match(/^\/artist\/(.+)$/))) {
    return { screen: 'artist', artistKey: { id: decodeURIComponent(m[1]) } };
  }

  // Unknown → home.
  return { screen: 'home' };
}

export function buildHash(state) {
  if (!state?.screen) return '#/';
  const { screen, artistKey, detailPlaylistId, catalogPlaylistId, hubLang } = state;
  if (screen === 'artist') {
    if (artistKey?.id)   return `#/artist/${encodeURIComponent(artistKey.id)}`;
    if (artistKey?.name) return `#/artist/by-name/${encodeURIComponent(artistKey.name)}`;
    return '#/';
  }
  if (screen === 'playlist-detail'      && detailPlaylistId != null)  return `#/playlist/${encodeURIComponent(detailPlaylistId)}`;
  if (screen === 'catalog-playlist-detail' && catalogPlaylistId  != null) return `#/catalog/${encodeURIComponent(catalogPlaylistId)}`;
  if (screen === 'language-hub'         && hubLang)                   return `#/lang/${encodeURIComponent(hubLang)}`;
  const simple = SIMPLE_REVERSE[screen];
  if (simple) return `#${simple}`;
  return '#/';
}

export function hashIsActive() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hash;
  return !!h && h !== '#' && h !== '#/';
}

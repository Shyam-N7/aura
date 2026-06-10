// Path-based route serializer. Layered on top of App.jsx's setScreen state
// machine — these helpers don't own state, they just translate between
// `{ screen, artistKey, detailPlaylistId, catalogPlaylistId, albumId, hubLang }`
// and a pathname like `/artist/abc123`.
//
// Paths (not hashes) so URLs are clean and crawlable: Vercel rewrites every
// non-/api path to index.html (SPA fallback), and Vite's dev server does the
// same, so no server routes are needed. Legacy `#/...` links are redirected
// once at boot in main.jsx (the path format is identical to the old hash path).

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

// Reverse map for buildPath — screen name → simple path.
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

// parsePath('/artist/abc123') → { screen: 'artist', artistKey: { id: 'abc123' } }
export function parsePath(path) {
  if (!path || path === '/') return { screen: 'home' };
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
  if ((m = path.match(/^\/album\/(.+)$/))) {
    return { screen: 'album-detail', albumId: decodeURIComponent(m[1]) };
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

export function buildPath(state) {
  if (!state?.screen) return '/';
  const { screen, artistKey, detailPlaylistId, catalogPlaylistId, albumId, hubLang } = state;
  if (screen === 'artist') {
    if (artistKey?.id)   return `/artist/${encodeURIComponent(artistKey.id)}`;
    if (artistKey?.name) return `/artist/by-name/${encodeURIComponent(artistKey.name)}`;
    return '/';
  }
  if (screen === 'playlist-detail'      && detailPlaylistId != null)  return `/playlist/${encodeURIComponent(detailPlaylistId)}`;
  if (screen === 'catalog-playlist-detail' && catalogPlaylistId  != null) return `/catalog/${encodeURIComponent(catalogPlaylistId)}`;
  if (screen === 'album-detail'         && albumId != null)           return `/album/${encodeURIComponent(albumId)}`;
  if (screen === 'language-hub'         && hubLang)                   return `/lang/${encodeURIComponent(hubLang)}`;
  const simple = SIMPLE_REVERSE[screen];
  if (simple) return simple;
  return '/';
}

// True when the pathname points at an in-app route (deep link). `/auth` is the
// pre-auth sign-in page, never an app destination.
export function pathIsActive(path) {
  const p = path ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return !!p && p !== '/' && p !== '/auth';
}

// ── Post-auth deep-link stash ────────────────────────────────────────────
// A logged-out visitor opening /artist/x gets bounced to the landing page, and
// navigate('/auth') would wipe the path. Stash it (sessionStorage — dies with
// the tab) and send them there after sign-in. Guards reject anything that isn't
// a same-origin absolute path ('//' would be scheme-relative).
const STASH_KEY = 'aura.postAuthPath';

export function stashPostAuthPath(path) {
  try {
    if (pathIsActive(path) && path.startsWith('/') && !path.startsWith('//')) {
      sessionStorage.setItem(STASH_KEY, path);
    }
  } catch { /* sessionStorage disabled */ }
}
export function consumePostAuthPath() {
  try {
    const p = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    return (p && p.startsWith('/') && !p.startsWith('//') && pathIsActive(p)) ? p : null;
  } catch { return null; }
}
export function clearPostAuthPath() {
  try { sessionStorage.removeItem(STASH_KEY); } catch { /* ignore */ }
}

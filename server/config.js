// Centralized runtime config. Every value that identifies — or is needed to
// reach — the upstream catalog + lyrics providers is read from the environment,
// loaded at boot via `node --env-file=.env.local`, so none of it lives in
// committed source. Anything missing fails fast HERE with a clear message
// rather than surfacing as a confusing fetch/crypto error deep in a request.
// See .env.example for the full list.

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var ${name}. Add it to .env.local (see .env.example).`);
  }
  return value;
}

function requiredInt(name) {
  const value = required(name);
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Env var ${name} must be a number, got "${value}".`);
  }
  return n;
}

// ── Catalog provider: endpoint, media decryption, request shape ──
export const CATALOG_API_BASE    = required('CATALOG_API_BASE');
export const CATALOG_MEDIA_KEY   = required('CATALOG_MEDIA_KEY');
export const CATALOG_BITRATE     = requiredInt('CATALOG_BITRATE');
export const CATALOG_USER_AGENT  = required('CATALOG_USER_AGENT');
export const CATALOG_CTX         = required('CATALOG_CTX');
export const CATALOG_CTX_HOME    = required('CATALOG_CTX_HOME');
export const CATALOG_API_VERSION = required('CATALOG_API_VERSION');

// CDN URL rewrite patterns (audio quality + image size live in the URL path).
export const CATALOG_AUDIO_SRC_QUALITY = required('CATALOG_AUDIO_SRC_QUALITY');
export const CATALOG_IMG_SRC_SIZE      = required('CATALOG_IMG_SRC_SIZE');
export const CATALOG_IMG_DEST_SIZE     = required('CATALOG_IMG_DEST_SIZE');

// Catalog API methods (the `__call` values).
export const CATALOG_M_SEARCH   = required('CATALOG_M_SEARCH');
export const CATALOG_M_SONG     = required('CATALOG_M_SONG');
export const CATALOG_M_HOME     = required('CATALOG_M_HOME');
export const CATALOG_M_PLAYLIST = required('CATALOG_M_PLAYLIST');
export const CATALOG_M_RECO     = required('CATALOG_M_RECO');
export const CATALOG_M_LYRICS   = required('CATALOG_M_LYRICS');
export const CATALOG_M_ARTIST   = required('CATALOG_M_ARTIST');
export const CATALOG_M_ALBUM    = required('CATALOG_M_ALBUM');

// ── Synced-lyrics provider ──
export const LYRICS_API_BASE   = required('LYRICS_API_BASE');
export const LYRICS_USER_AGENT = required('LYRICS_USER_AGENT');
export const LYRICS_TIMEOUT_MS = requiredInt('LYRICS_TIMEOUT_MS');

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

// Opt-in vars: blank/unset is fine (the feature stays off), so these never
// fail-fast at boot — they fall back to the given default instead.
function optional(name, fallback = '') {
  const value = process.env[name];
  return (value === undefined || value === '') ? fallback : value;
}

function optionalInt(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ── Catalog provider: endpoint, media decryption, request shape ──
export const CATALOG_API_BASE    = required('CATALOG_API_BASE');
export const CATALOG_MEDIA_KEY   = required('CATALOG_MEDIA_KEY');
export const CATALOG_BITRATE     = requiredInt('CATALOG_BITRATE');
export const CATALOG_USER_AGENT  = required('CATALOG_USER_AGENT');
export const CATALOG_CTX         = required('CATALOG_CTX');
export const CATALOG_CTX_HOME    = required('CATALOG_CTX_HOME');
// The song-station endpoints only return results on this ctx — the app's default
// CATALOG_CTX returns an empty station. Optional: blank disables the station path,
// degrading related-tracks to the artist-seeded fallback rather than failing boot.
export const CATALOG_CTX_STATION = optional('CATALOG_CTX_STATION');
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
// Per-song station (createEntityStation + getSong) — the source of "related / up
// next" tracks. Optional so a missing prod env degrades to the fallback (see
// CATALOG_CTX_STATION) rather than failing boot.
export const CATALOG_M_STATION_CREATE = optional('CATALOG_M_STATION_CREATE');
export const CATALOG_M_STATION_SONGS  = optional('CATALOG_M_STATION_SONGS');
export const CATALOG_M_LYRICS   = required('CATALOG_M_LYRICS');
export const CATALOG_M_ARTIST   = required('CATALOG_M_ARTIST');
export const CATALOG_M_ALBUM    = required('CATALOG_M_ALBUM');
export const CATALOG_M_SUGGEST  = required('CATALOG_M_SUGGEST');   // autocomplete.get — multi-entity search

// ── Admin-only gate (dev/staging) ──
// When ADMIN_ONLY=1, only ADMIN_EMAILS may sign up / sign in (enforced in
// adminGate.js). Blank — the prod default — leaves auth open to everyone, so this
// is inert in production and safe to merge to main.
export const ADMIN_ONLY   = optional('ADMIN_ONLY') === '1';
export const ADMIN_EMAILS = optional('ADMIN_EMAILS')
  .split(',').map((s) => s.toLowerCase().trim()).filter(Boolean);

// ── Synced-lyrics provider (LRCLIB) ──
export const LYRICS_API_BASE   = required('LYRICS_API_BASE');
export const LYRICS_USER_AGENT = required('LYRICS_USER_AGENT');
export const LYRICS_TIMEOUT_MS = requiredInt('LYRICS_TIMEOUT_MS');

// ── Additional synced-lyrics providers (opt-in) ──
// Musixmatch via the community usertoken (best Indian-regional coverage). Leave
// MUSIXMATCH_USERTOKEN blank to skip the provider. NetEase needs a self-hosted
// NeteaseCloudMusicApi base URL. See .env.example for the ToS caveat.
export const MUSIXMATCH_USERTOKEN  = optional('MUSIXMATCH_USERTOKEN');
export const MUSIXMATCH_API_BASE   = optional('MUSIXMATCH_API_BASE', 'https://apic-desktop.musixmatch.com/ws/1.1/');
export const MUSIXMATCH_TIMEOUT_MS = optionalInt('MUSIXMATCH_TIMEOUT_MS', LYRICS_TIMEOUT_MS);
export const NETEASE_API_BASE      = optional('NETEASE_API_BASE');

// ── Lyrics generation worker (Replicate WhisperX) — opt-in ──
// When REPLICATE_API_TOKEN + PUBLIC_BASE_URL are set, songs with no synced match
// in any provider are queued and transcribed-and-aligned from their audio. Left
// blank, generation is disabled and those songs simply read "not available".
export const REPLICATE_API_TOKEN     = optional('REPLICATE_API_TOKEN');
export const REPLICATE_WHISPER_MODEL = optional('REPLICATE_WHISPER_MODEL', 'victor-upmeet/whisperx');
export const PUBLIC_BASE_URL         = optional('PUBLIC_BASE_URL');      // e.g. https://aurafm.live (for the Replicate webhook callback)
export const LYRICS_WEBHOOK_SECRET   = optional('LYRICS_WEBHOOK_SECRET'); // shared secret guarding the webhook (fallback when no signing secret)
// Replicate's webhook signing secret (whsec_…, from GET /v1/webhooks/default/secret).
// When set, the webhook is authenticated by HMAC signature instead of a URL token,
// so no secret travels in the callback URL (which Replicate logs). See replicateWebhook.js.
export const REPLICATE_WEBHOOK_SIGNING_SECRET = optional('REPLICATE_WEBHOOK_SIGNING_SECRET');
export const CRON_SECRET             = optional('CRON_SECRET');           // Vercel Cron bearer token authorizing /api/lyrics-jobs/process
export const LYRICS_GEN_DAILY_CAP    = optionalInt('LYRICS_GEN_DAILY_CAP', 500); // max generation jobs dispatched per day (spend guard)

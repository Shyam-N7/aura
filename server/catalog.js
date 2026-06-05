// Upstream catalog access. We call the provider's public web API directly and
// decrypt the audio URLs the same way every public client does. The endpoint,
// media key, request methods, and CDN patterns all come from config (env) so
// none of the provider's details live in committed source.

import CryptoJS from 'crypto-js';
import {
  CATALOG_API_BASE, CATALOG_MEDIA_KEY, CATALOG_BITRATE, CATALOG_USER_AGENT,
  CATALOG_CTX, CATALOG_CTX_HOME, CATALOG_API_VERSION,
  CATALOG_AUDIO_SRC_QUALITY, CATALOG_IMG_SRC_SIZE, CATALOG_IMG_DEST_SIZE,
  CATALOG_M_SEARCH, CATALOG_M_SONG, CATALOG_M_HOME, CATALOG_M_PLAYLIST,
} from './config.js';

const HTML_ENTITIES = { amp: '&', quot: '"', '#039': "'", apos: "'", lt: '<', gt: '>' };
export function decodeEntities(s) {
  if (!s) return s;
  return s.replace(/&(#?\w+);/g, (_, e) => HTML_ENTITIES[e] ?? `&${e};`);
}

// Parse the 8-byte DES key once (avoids re-parsing per call) and fail loud on a
// misconfigured key length — the native `des-ecb` cipher threw 'Invalid key
// length', so preserve that rather than silently producing garbage URLs.
const MEDIA_KEY = CryptoJS.enc.Utf8.parse(CATALOG_MEDIA_KEY);
if (MEDIA_KEY.sigBytes !== 8) {
  throw new Error(`CATALOG_MEDIA_KEY must be exactly 8 bytes for DES-ECB (got ${MEDIA_KEY.sigBytes})`);
}

export function decryptMediaUrl(encrypted, bitrate = CATALOG_BITRATE) {
  if (!encrypted) return null;
  try {
    // DES-ECB with PKCS#7 padding over base64 ciphertext. Ported from Node's
    // crypto (`des-ecb`) to pure-JS crypto-js so it runs without OpenSSL's
    // legacy provider: Node 18+ moved DES out of the default provider, and the
    // `--openssl-legacy-provider` flag isn't available to Vercel functions.
    // DES-ECB/PKCS7 is deterministic, so the decrypted output is identical.
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encrypted) },
      MEDIA_KEY,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
    );
    const url = decrypted.toString(CryptoJS.enc.Utf8);
    // crypto-js returns '' (not a throw) for undecryptable input, where the old
    // node cipher threw → null. Normalize so the contract is unchanged and no
    // track ever carries streamUrl:"".
    if (!url) return null;
    return url.replace(CATALOG_AUDIO_SRC_QUALITY, `_${bitrate}.mp4`);
  } catch {
    return null;
  }
}

export function pickImageUrl(image) {
  if (!image) return null;
  return image.replace(CATALOG_IMG_SRC_SIZE, CATALOG_IMG_DEST_SIZE);
}

export function mapSong(r) {
  const info = r.more_info ?? {};
  // The detail call returns encrypted_media_url at top level; search nests it under more_info.
  const encryptedMedia = info.encrypted_media_url ?? r.encrypted_media_url ?? null;
  const album          = info.album ?? r.album ?? null;
  const duration       = info.duration ?? r.duration ?? null;
  const artistName     = info.artistMap?.primary_artists?.[0]?.name
                      ?? r.primary_artists
                      ?? r.singers
                      ?? r.subtitle
                      ?? '';
  return {
    id:          r.id,
    title:       decodeEntities(r.title ?? r.song ?? ''),
    artist:      decodeEntities(artistName),
    album:       decodeEntities(album),
    language:    r.language ?? null,
    durationSec: Number(duration) || null,
    streamUrl:   decryptMediaUrl(encryptedMedia),
    imageUrl:    pickImageUrl(r.image),
  };
}

export async function getSongDetails(ids) {
  if (!ids || ids.length === 0) return [];
  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_SONG);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX);
  url.searchParams.set('pids',        ids.join(','));

  const res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`catalog ${res.status}: ${text.slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }
  const body = await res.json();
  // body is a map keyed by song id: { "id1": {...}, "id2": {...} }
  // OR sometimes { songs: [...] }
  const songs = Array.isArray(body?.songs)
    ? body.songs
    : (body && typeof body === 'object' ? Object.values(body) : []);
  return songs.filter(s => s && s.id).map(mapSong);
}

// The provider returns the same song under multiple IDs (single, OST album,
// extended cut, etc.) — same title+artist, different `id`. Dedupe by lowered
// title|artist so each shelf shows the song exactly once. Keeps the first
// occurrence, usually the canonical/most-popular version per the provider's ranking.
export function dedupeSongs(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    if (!t) continue;
    const key = `${(t.title ?? '').toLowerCase()}|${(t.artist ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function mapPlaylistSummary(r) {
  if (!r?.id) return null;
  const info = r.more_info ?? {};
  return {
    id:            r.id,
    name:          decodeEntities(r.title ?? r.listname ?? ''),
    coverImageUrl: pickImageUrl(r.image),
    trackCount:    Number(info.song_count ?? r.numsongs ?? 0) || null,
    subtitle:      decodeEntities(r.subtitle ?? info.firstname ?? ''),
    kind:          'catalog',
  };
}

// The provider's home payload mixes songs / albums / playlists in `new_trending`,
// `top_playlists`, etc. We split into the buckets HomeScreen actually wants
// (trending songs + featured playlists). The shape can drift; if a key is
// missing we return an empty bucket and the shelf hides gracefully.
export async function getCatalogHome({ lang } = {}) {
  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_HOME);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX_HOME);
  if (lang) url.searchParams.set('language', lang);

  const res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`catalog home ${res.status}: ${text.slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }
  const body = await res.json();
  const trending = dedupeSongs(
    (body?.new_trending ?? [])
      .filter(x => x?.type === 'song' || (!x?.type && x?.encrypted_media_url))
      .map(mapSong)
      .filter(t => t.id && t.streamUrl)
  );
  const featuredPlaylists = (body?.top_playlists ?? [])
    .map(mapPlaylistSummary)
    .filter(Boolean);
  return { trending, featuredPlaylists };
}

// Editorial playlist detail from the provider. Returns { id, name, image, tracks: Track[] }.
export async function getCatalogPlaylistDetail(id) {
  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_PLAYLIST);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX);
  url.searchParams.set('listid',      id);

  const res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`catalog playlist ${res.status}: ${text.slice(0, 200)}`);
    err.statusCode = res.status === 404 ? 404 : 502;
    throw err;
  }
  const body = await res.json();
  const tracks = (body?.songs ?? body?.list ?? [])
    .map(mapSong)
    .filter(t => t.id && t.streamUrl);
  return {
    id,
    name:          decodeEntities(body?.listname ?? body?.title ?? ''),
    coverImageUrl: pickImageUrl(body?.image),
    trackCount:    tracks.length,
    tracks,
  };
}

export async function searchSongs(query, { limit = 20, lang } = {}) {
  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_SEARCH);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX);
  url.searchParams.set('p',           '1');
  url.searchParams.set('n',           String(Math.min(limit, 40)));
  url.searchParams.set('q',           query);

  const res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`catalog ${res.status}: ${text.slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }
  const body = await res.json();
  let results = (body?.results ?? []).map(mapSong);
  if (lang) {
    const want = lang.toLowerCase();
    results = results.filter(r => (r.language ?? '').toLowerCase() === want);
  }
  return dedupeSongs(results).slice(0, limit);
}

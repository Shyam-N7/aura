// Related-tracks lookup. The catalog's related endpoint returns a mix of same-artist
// and genre-similar songs for a given pid. We fall back to an artist+language
// search if reco comes back empty (some catalogue tracks have no reco entries).

import { searchSongs, decodeEntities, decryptMediaUrl, pickImageUrl } from './catalog.js';
import { cacheTracks, getTrackById } from './tracks.js';
import { CATALOG_API_BASE, CATALOG_USER_AGENT, CATALOG_CTX, CATALOG_API_VERSION, CATALOG_M_RECO } from './config.js';

// Strip "(From "Movie Name")" / "(From X)" suffix and normalize for dedup so
// "Aura 10/10" and "Aura 10/10 (From "Meesaya Murukku 2")" collapse together.
function normalizeKey(t) {
  if (!t) return '';
  const title = (t.title ?? '')
    .replace(/\s*\(from\s+["“”'][^"“”']*["“”']\)\s*$/iu, '')
    .replace(/\s*\(from\s+[^)]*\)\s*$/iu, '')
    .trim()
    .toLowerCase();
  const artist = (t.artist ?? '').toLowerCase().trim();
  return `${title}|${artist}`;
}
function dedupeRelated(tracks, seedKey) {
  const seen = new Set();
  if (seedKey) seen.add(seedKey);
  const out = [];
  for (const t of tracks) {
    if (!t) continue;
    const k = normalizeKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// The related endpoint returns lighter song objects than search/detail; normalise.
function mapRecoSong(r) {
  const info = r.more_info ?? {};
  return {
    id:          r.id,
    title:       decodeEntities(r.title ?? r.song ?? ''),
    artist:      decodeEntities(info.artistMap?.primary_artists?.[0]?.name ?? r.subtitle ?? ''),
    album:       decodeEntities(info.album ?? r.album ?? null),
    language:    r.language ?? null,
    durationSec: Number(info.duration ?? r.duration) || null,
    streamUrl:   decryptMediaUrl(info.encrypted_media_url ?? r.encrypted_media_url),
    imageUrl:    pickImageUrl(r.image),
  };
}

// Tiny LRU keyed by pid|lang. Tracks change as users listen, so 100 entries is
// plenty and cheap.
const cache = new Map();
const CACHE_MAX = 100;
function cacheGet(k) {
  if (!cache.has(k)) return null;
  const v = cache.get(k);
  cache.delete(k); cache.set(k, v);   // bump to MRU
  return v;
}
function cacheSet(k, v) {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export async function getRelatedTracks(pid, { lang } = {}) {
  if (!pid) return [];
  const key = `${pid}|${lang ?? ''}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  // Look up the seed so we can dedupe by normalized title+artist (not just id).
  // The catalog often returns the same song under multiple ids (single / OST / extended)
  // with slight title variants — without this the rail shows "Aura 10/10" twice.
  const seed = await getTrackById(pid).catch(() => null);
  const seedKey = seed ? normalizeKey(seed) : '';

  let tracks = [];
  try {
    const url = new URL(CATALOG_API_BASE);
    url.searchParams.set('__call',      CATALOG_M_RECO);
    url.searchParams.set('_format',     'json');
    url.searchParams.set('_marker',     '0');
    url.searchParams.set('api_version', CATALOG_API_VERSION);
    url.searchParams.set('ctx',         CATALOG_CTX);
    url.searchParams.set('pid',         pid);
    if (lang) url.searchParams.set('language', lang);
    const res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
    if (res.ok) {
      const body = await res.json();
      const arr = Array.isArray(body) ? body : (body?.songs ?? body?.list ?? []);
      tracks = arr.filter(r => r?.id).map(mapRecoSong).filter(t => t.id && t.streamUrl);
    }
  } catch { /* fall through to artist search */ }

  // Fallback: artist-anchored search when reco returns nothing.
  if (tracks.length === 0 && seed?.artist) {
    try {
      const radio = await searchSongs(`${seed.artist} ${seed.language ?? ''}`.trim(), {
        lang: lang || seed.language || undefined,
        limit: 10,
      });
      tracks = radio;
    } catch { /* leave empty */ }
  }

  tracks = dedupeRelated(tracks, seedKey);

  // Relevance: prefer same-language and same-artist matches; let cross-language
  // tracks ride at the end so they only surface when we don't have enough
  // primary matches. the catalog's related endpoint is a bit loose with the language
  // hint, so this stable sort keeps the rail feeling on-topic.
  const seedLang = (lang || seed?.language || '').toLowerCase();
  const seedArtist = (seed?.artist || '').toLowerCase().trim();
  if (seedLang || seedArtist) {
    const score = (t) => {
      const tl = (t.language || '').toLowerCase();
      const ta = (t.artist || '').toLowerCase().trim();
      // Lower score floats to the top.
      let s = 0;
      if (seedLang && tl !== seedLang) s += 10;
      if (seedArtist && ta !== seedArtist) s += 1;
      return s;
    };
    tracks = tracks
      .map((t, i) => ({ t, i, s: score(t) }))
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map(x => x.t);
  }

  tracks = tracks.slice(0, 8);
  if (tracks.length > 0) cacheTracks(tracks);
  cacheSet(key, tracks);
  return tracks;
}

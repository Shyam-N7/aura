// Related-tracks lookup. Builds a per-song station off the catalog's webradio
// endpoints — a mix of similar-vibe songs for a given pid. We keep it song-similar:
// no same-artist boost, capped to a couple of tracks per artist for diversity, and
// when the station is empty we fall back to an artist-seeded same-language search.

import { searchSongs, decodeEntities, decryptMediaUrl, pickImageUrl } from './catalog.js';
import { cacheTracks, getTrackById } from './tracks.js';
import { pool } from './db.js';
import {
  CATALOG_API_BASE, CATALOG_USER_AGENT, CATALOG_API_VERSION,
  CATALOG_M_STATION_CREATE, CATALOG_M_STATION_SONGS, CATALOG_CTX_STATION,
} from './config.js';

// Strip "(From "Movie Name")" / "(From X)" suffix and normalize a title for
// dedup so "Aura 10/10" and "Aura 10/10 (From "Meesaya Murukku 2")" — and a
// song's original vs. a cover/alt-credit recording of it — collapse together.
function normalizeTitle(s) {
  return (s ?? '')
    .replace(/\(from\s+[^)]*\)/giu, ' ')                                            // "(From "Movie")" anywhere
    .replace(/\s*[-–—]\s*(telugu|tamil|hindi|malayalam|kannada|english)\s*$/iu, '') // trailing " - <language>"
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
// Dedup the radio batch by TITLE ALONE (artist-agnostic). The same song often
// shows up credited to different artists (composer / lyricist / a cover singer);
// keying on title+artist let all of them through and the queue filled with
// "Marandhu Poche" by three people. Caller sorts so the canonical recording
// (same-artist / same-language as the seed) sits first, so keeping the first
// occurrence per title keeps the original and drops the covers.
function dedupeByTitle(tracks, seedTitle) {
  const seen = new Set();
  if (seedTitle) seen.add(seedTitle);   // never recommend the seed song itself
  const out = [];
  for (const t of tracks) {
    if (!t) continue;
    const k = normalizeTitle(t.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// Keep the radio diverse: allow at most `max` tracks from any single artist (incl.
// the seed artist), preserving order. Without this a reco list can collapse into one
// artist's catalogue and feel like "their greatest hits".
function capPerArtist(tracks, max = 2) {
  const counts = new Map();
  const out = [];
  for (const t of tracks) {
    const a = (t.artist || '').toLowerCase().trim();
    if (a) {
      const n = counts.get(a) ?? 0;
      if (n >= max) continue;
      counts.set(a, n + 1);
    }
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
    explicit:    String(r.explicit_content ?? info.explicit_content ?? '0') === '1',
  };
}

// JioSaavn's per-song "station" — its own song-radio, and the source of genuinely
// similar tracks. Two steps: create a station seeded by the track, then pull its
// songs. It only works on ctx=android (the app's web6dot0/wap6dot0 contexts return
// an empty station), so this path uses its own ctx. The songs come back in the same
// shape search/detail return, so mapRecoSong normalises them. Returns [] on any
// miss — the caller then drops to the artist-seeded fallback.
async function fetchStationSongs(pid, count) {
  if (!CATALOG_M_STATION_CREATE || !CATALOG_M_STATION_SONGS || !CATALOG_CTX_STATION) return [];
  const call = (method, extra) => {
    const url = new URL(CATALOG_API_BASE);
    url.searchParams.set('__call',      method);
    url.searchParams.set('_format',     'json');
    url.searchParams.set('_marker',     '0');
    url.searchParams.set('api_version', CATALOG_API_VERSION);
    url.searchParams.set('ctx',         CATALOG_CTX_STATION);
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  };
  try {
    const cres = await call(CATALOG_M_STATION_CREATE, { entity_id: JSON.stringify([pid]), entity_type: 'queue' });
    if (!cres.ok) return [];
    const stationid = (await cres.json())?.stationid;
    if (!stationid) return [];
    const sres = await call(CATALOG_M_STATION_SONGS, { stationid, k: String(count), next: '1' });
    if (!sres.ok) return [];
    const body = await sres.json();
    // getSong returns { "0": {song}, "1": {song}, …, stationid } — take the numeric
    // slots only (skip the stationid key), unwrap .song, then normalise.
    return Object.keys(body)
      .filter(k => /^\d+$/.test(k))
      .map(k => body[k]?.song ?? body[k])
      .filter(Boolean)
      .map(mapRecoSong)
      .filter(t => t.id && t.streamUrl);
  } catch {
    return [];
  }
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
  cache.delete(k); cache.set(k, v);   // delete-first so a re-set bumps to MRU
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// Persist the seed→related edges as OUR own copy of the similarity graph (the
// data foundation a future engine bootstraps from). Best-effort and fire-and-
// forget — never blocks or fails the request. No FK on track_similarity, so it's
// safe even before every related track is cached.
function recordSimilarity(sourceId, related, provenance) {
  const rows = (related || []).filter(t => t?.id && t.id !== sourceId).slice(0, 20);
  if (!sourceId || !rows.length) return;
  const now = Date.now();
  const values = [];
  const params = [];
  rows.forEach((t, i) => {
    const b = i * 5;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
    params.push(sourceId, t.id, provenance, i, now);
  });
  pool.query(
    `INSERT INTO track_similarity (source_track_id, related_track_id, provenance, rank, observed_at)
     VALUES ${values.join(',')}
     ON CONFLICT (source_track_id, related_track_id, provenance)
     DO UPDATE SET rank = EXCLUDED.rank, observed_at = EXCLUDED.observed_at`,
    params,
  ).catch(() => { /* signal capture is best-effort */ });
}

export async function getRelatedTracks(pid, { lang, limit } = {}) {
  if (!pid) return [];
  // Callers ask for different counts: the related rail wants 8, auto-radio
  // prefetches a ~15-track batch to fill the queue. Clamp the request, cache
  // the full sorted list once, and slice per call so a larger ask never needs
  // a second upstream round-trip.
  const want = Number.isFinite(limit) ? Math.min(20, Math.max(1, Math.floor(limit))) : 8;
  const key = `${pid}|${lang ?? ''}`;
  const hit = cacheGet(key);
  if (hit) return hit.slice(0, want);

  // Look up the seed so we can dedupe by normalized title (artist-agnostic) and
  // bias the order toward the seed's artist/language before collapsing covers.
  const seed = await getTrackById(pid).catch(() => null);
  const seedTitle = seed ? normalizeTitle(seed.title) : '';

  // Ask the station for a bit more than the caller wants so refine/dedupe/cap below
  // have room to trim. The station is seeded purely by the song, so its results are
  // already same-language — no language param needed.
  let tracks = await fetchStationSongs(pid, Math.max(15, want));
  let provenance = 'station';

  // Relevance + dedup, applied to whichever source we use. Prefer same-language
  // and same-artist matches and sink explicit covers BEFORE the by-title dedup so
  // that, among multiple recordings of one song, the canonical one (seed's
  // artist/language) is the keeper; then collapse cover/alt-credit duplicates and
  // the seed itself by title.
  const seedLang = (lang || seed?.language || '').toLowerCase();
  const COVER_RE = /\b(karaoke|cover|instrumental|tribute|remix|reprise|unplugged)\b/i;
  // Keep the station's own similarity order; only sink other-language + explicit
  // covers. We deliberately DON'T bias toward the seed artist — that bias was what
  // made the radio feel like the artist's greatest hits. Per-artist diversity is
  // handled by capPerArtist below.
  const refine = (list) => {
    const score = (t) => {
      const tl = (t.language || '').toLowerCase();
      let s = 0;                                   // lower floats to the top
      if (seedLang && tl !== seedLang) s += 10;
      if (COVER_RE.test(t.title || '')) s += 5;    // sink explicit cover/karaoke variants
      return s;
    };
    const out = list
      .map((t, i) => ({ t, i, s: score(t) }))
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map(x => x.t);
    return dedupeByTitle(out, seedTitle);
  };

  tracks = capPerArtist(refine(tracks));

  // Fallback (rare — only if the station is empty or collapses after dedup): seed a
  // same-language search off the seed's primary artist so the radio stays in the
  // song's neighbourhood instead of going generic. capPerArtist(2) keeps the seed
  // artist from dominating; with no known artist, fall back to a language radio.
  if (tracks.length === 0) {
    const fallbackLang = lang || seed?.language || undefined;
    const q = (seed?.artist || '').trim() || (fallbackLang ? `${fallbackLang} songs` : '');
    if (q) {
      try {
        const radio = await searchSongs(q, { lang: fallbackLang, limit: Math.max(10, want) });
        tracks = capPerArtist(refine(radio));
        provenance = 'related';
      } catch { /* leave empty */ }
    }
  }

  tracks = tracks.slice(0, 20);   // keep up to the max; callers slice to their limit
  if (tracks.length > 0) { cacheTracks(tracks); recordSimilarity(pid, tracks, provenance); }
  cacheSet(key, tracks);
  return tracks.slice(0, want);
}

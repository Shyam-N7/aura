// Related-tracks lookup. Uses the catalog's song-seeded reco endpoint — a mix of
// similar-vibe and some same-artist songs for a given pid. We keep it song-similar:
// no same-artist boost, capped to a couple of tracks per artist for diversity, and
// when reco is empty we fall back to a same-language radio (never the seed artist).

import { searchSongs, decodeEntities, decryptMediaUrl, pickImageUrl } from './catalog.js';
import { cacheTracks, getTrackById } from './tracks.js';
import { CATALOG_API_BASE, CATALOG_USER_AGENT, CATALOG_CTX, CATALOG_API_VERSION, CATALOG_M_RECO } from './config.js';

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
  cache.delete(k); cache.set(k, v);   // delete-first so a re-set bumps to MRU
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
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

  // Relevance + dedup, applied to whichever source we use. Prefer same-language
  // and same-artist matches and sink explicit covers BEFORE the by-title dedup so
  // that, among multiple recordings of one song, the canonical one (seed's
  // artist/language) is the keeper; then collapse cover/alt-credit duplicates and
  // the seed itself by title.
  const seedLang = (lang || seed?.language || '').toLowerCase();
  const seedArtist = (seed?.artist || '').toLowerCase().trim();
  const COVER_RE = /\b(karaoke|cover|instrumental|tribute|remix|reprise|unplugged)\b/i;
  // Keep reco's own similarity order; only sink other-language + explicit covers. We
  // deliberately DON'T bias toward the seed artist — that bias was what made the radio
  // feel like the artist's greatest hits. Per-artist diversity is handled by
  // capPerArtist below.
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

  // Fallback: a same-language radio (NEVER the seed artist) when reco returns nothing
  // or collapses to nothing after dedup. We never fall back to the artist's catalogue.
  if (tracks.length === 0 && (seed?.language || lang)) {
    try {
      const radio = await searchSongs(`${seed?.language ?? lang} songs`, {
        lang: lang || seed?.language || undefined,
        limit: Math.max(10, want),
      });
      tracks = capPerArtist(
        refine(radio).filter(t => (t.artist || '').toLowerCase().trim() !== seedArtist),
      );
    } catch { /* leave empty */ }
  }

  tracks = tracks.slice(0, 20);   // keep up to the max; callers slice to their limit
  if (tracks.length > 0) cacheTracks(tracks);
  cacheSet(key, tracks);
  return tracks.slice(0, want);
}

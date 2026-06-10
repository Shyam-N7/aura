// Artist detail lookup. Two-step: resolve the artist id by name → fetch the
// artist page for the full payload (top tracks + albums + similar artists +
// bio). Callers that already have a catalog artist id (e.g. clicking through
// "fans also like") can pass it directly to skip the lookup hop.

import { cacheTracks } from './tracks.js';
import { decodeEntities, pickImageUrl, mapSong } from './catalog.js';
import {
  CATALOG_API_BASE, CATALOG_USER_AGENT, CATALOG_CTX, CATALOG_API_VERSION,
  CATALOG_M_SONG, CATALOG_M_SEARCH, CATALOG_M_ARTIST, CATALOG_M_ALBUM,
} from './config.js';

// Normalize an artist name for tokenized matching:
// "A.R. Rahman" / "a r rahman" / "A-R Rahman" all → "a r rahman".
function normName(s) {
  return (s ?? '')
    .toLowerCase()
    .replace(/[.\-_/]/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Token-set score for picking the closest artist match from a candidate list.
// -1 means the candidate is disqualified (missing one or more query tokens).
function matchScore(query, candidate) {
  const qTokens = normName(query).split(' ').filter(Boolean);
  const cName   = normName(candidate);
  const cTokens = new Set(cName.split(' ').filter(Boolean));
  if (qTokens.length === 0) return 0;
  if (!qTokens.every(t => cTokens.has(t))) return -1;
  if (cName === normName(query)) return 100;
  if (cTokens.size === qTokens.length) return 50 + qTokens.length;
  return qTokens.length;
}

function mapAlbumSummary(r) {
  if (!r?.id) return null;
  const info = r.more_info ?? {};
  return {
    id:       r.id,
    name:     decodeEntities(r.title ?? r.name ?? ''),
    image:    pickImageUrl(r.image),
    year:     info.year ?? r.year ?? null,
    artist:   decodeEntities(info.music ?? info.artistMap?.primary_artists?.[0]?.name ?? ''),
  };
}

function mapArtistSummary(r) {
  if (!r?.id) return null;
  return {
    id:    r.id,
    name:  decodeEntities(r.name ?? r.title ?? ''),
    image: pickImageUrl(r.image),
  };
}

// Tiny LRUs — artist + album payloads are stable enough to cache for the
// session. 100 each is plenty for casual browsing.
function makeLru(max = 100) {
  const c = new Map();
  return {
    get(k) {
      if (!c.has(k)) return null;
      const v = c.get(k);
      c.delete(k); c.set(k, v);
      return v;
    },
    set(k, v) {
      c.set(k, v);
      if (c.size > max) c.delete(c.keys().next().value);
    },
  };
}
const artistCache = makeLru(100);
const albumCache  = makeLru(100);

// Deterministic path: pull the artist id straight off a known song. The
// catalog's detail call returns an artistMap with real artist ids for every
// contributor — no name-guessing involved. If `name` is given, pick the
// matching contributor; otherwise take the first primary artist.
async function lookupArtistIdViaTrack(trackId, name) {
  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_SONG);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX);
  url.searchParams.set('pids',        trackId);
  const res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body) return null;
  const songs = Array.isArray(body?.songs)
    ? body.songs
    : (body && typeof body === 'object' ? Object.values(body) : []);
  const song = songs.find(s => s && s.id);
  if (!song) return null;
  const map = song.more_info?.artistMap ?? {};
  const buckets = [
    map.primary_artists ?? [],
    map.featured_artists ?? [],
    map.artists ?? [],
  ];
  const wantNorm = name ? normName(name) : null;
  for (const bucket of buckets) {
    if (wantNorm) {
      const exact = bucket.find(a => a?.id && normName(a.name) === wantNorm);
      if (exact) return exact.id;
      const fuzzy = bucket.find(a => a?.id && matchScore(name, a.name) >= 0);
      if (fuzzy) return fuzzy.id;
    } else {
      const first = bucket.find(a => a?.id);
      if (first) return first.id;
    }
  }
  return null;
}

// Fallback: search songs by the artist name and tally which artist id appears
// most across `more_info.artistMap.primary_artists[]`. Song search is ranked
// by content relevance (not popularity), and tracks consistently credit the
// real artist — so a frequency+score tally produces a far more reliable answer
// than `autocomplete.get`, which routinely surfaces a popular but wrong artist
// (Pawan Kalyan for "K. Kalyan", a typo'd Rehman for "A.R. Rahman", etc).
async function lookupArtistIdViaName(name) {
  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_SEARCH);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX);
  url.searchParams.set('p',           '1');
  url.searchParams.set('n',           '20');
  url.searchParams.set('q',           name);
  const res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const results = body?.results ?? [];

  // id → { count, bestScore }. Disqualify entries that fail matchScore so
  // partial-name impostors (Rehman vs Rahman) don't contaminate the tally.
  const tally = new Map();
  for (const r of results) {
    const primaries = r?.more_info?.artistMap?.primary_artists ?? [];
    for (const a of primaries) {
      if (!a?.id) continue;
      const s = matchScore(name, a.name);
      if (s < 0) continue;
      const prev = tally.get(a.id) ?? { count: 0, bestScore: -1 };
      prev.count++;
      if (s > prev.bestScore) prev.bestScore = s;
      tally.set(a.id, prev);
    }
  }
  if (tally.size === 0) return null;

  // Rank: score dominates (exact-name match should beat 10 frequency points),
  // count breaks ties.
  let best = null;
  let bestKey = -1;
  for (const [id, info] of tally) {
    const key = info.bestScore * 1000 + info.count;
    if (key > bestKey) {
      bestKey = key;
      best = id;
    }
  }
  return best;
}

export async function getArtistDetails({ name, id, trackId } = {}) {
  let artistId = id;
  if (!artistId) {
    if (!name && !trackId) {
      const err = new Error('missing artist name, id, or trackId');
      err.statusCode = 400;
      throw err;
    }
    // Prefer the deterministic trackId path when available — the catalog's
    // autocomplete is popularity-ranked and often misses the actual artist.
    if (trackId) {
      artistId = await lookupArtistIdViaTrack(trackId, name);
    }
    if (!artistId && name) {
      artistId = await lookupArtistIdViaName(name);
    }
    if (!artistId) {
      const err = new Error(`no catalog artist match for "${name ?? trackId}"`);
      err.statusCode = 404;
      throw err;
    }
  }

  const cacheKey = `id:${artistId}`;
  const hit = artistCache.get(cacheKey);
  if (hit) return hit;

  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_ARTIST);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX);
  url.searchParams.set('artistId',    artistId);
  url.searchParams.set('n_song',      '15');
  url.searchParams.set('n_album',     '12');

  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  } catch (err) {
    // Network-layer failure (DNS, refused, abort). Surface as 502 rather than
    // crashing the route with a generic 500.
    console.warn('[artists] page fetch network error:', err.cause?.code || err.message);
    const e = new Error(`catalog unreachable:${err.cause?.code || err.message}`);
    e.statusCode = 502;
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`catalog artist ${res.status}: ${text.slice(0, 200)}`);
    err.statusCode = res.status === 404 ? 404 : 502;
    throw err;
  }
  const body = await res.json().catch((err) => {
    console.warn('[artists] page json parse failed:', err.message);
    return null;
  });
  if (!body || typeof body !== 'object') {
    const err = new Error(`catalog returned empty/malformed payload for artist ${artistId}`);
    err.statusCode = 404;
    throw err;
  }

  // The catalog occasionally returns shapes we don't expect (e.g. promotional pages
  // for an artist id that's actually a label). Wrap the mapping defensively so
  // a single bad field doesn't 500 the route.
  let out;
  try {
    const topTracks = (body?.topSongs ?? [])
      .map(mapSong)
      .filter(t => t.id && t.streamUrl);
    const topAlbums = (body?.topAlbums ?? [])
      .map(mapAlbumSummary)
      .filter(Boolean);
    const similarArtists = (body?.similarArtists ?? [])
      .map(mapArtistSummary)
      .filter(Boolean);

    out = {
      id:            artistId,
      name:          decodeEntities(body?.name ?? body?.title ?? name ?? ''),
      image:         pickImageUrl(body?.image),
      bio:           decodeEntities(body?.bio?.[0]?.text ?? body?.bio?.text ?? ''),
      followerCount: Number(body?.fan_count ?? body?.followers ?? 0) || null,
      topTracks,
      topAlbums,
      similarArtists,
    };

    if (topTracks.length) cacheTracks(topTracks);
  } catch (err) {
    console.warn('[artists] mapping failed for', artistId, ':', err.message);
    const e = new Error(`couldn’t parse artist payload for ${artistId}`);
    e.statusCode = 502;
    throw e;
  }

  artistCache.set(cacheKey, out);
  return out;
}

// Full album / movie detail: metadata + tracklist. Indian-cinema soundtracks are
// modelled as albums upstream; `header_desc` carries the "Film"/"Album" wording,
// from which we derive `isMovie` for the screen's eyebrow.
export async function getAlbumDetail(albumId) {
  if (!albumId) {
    const err = new Error('missing album id');
    err.statusCode = 400;
    throw err;
  }
  const hit = albumCache.get(albumId);
  if (hit) return hit;

  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_ALBUM);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX);
  url.searchParams.set('albumid',     albumId);

  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  } catch (err) {
    console.warn('[albums] fetch network error:', err.cause?.code || err.message);
    const e = new Error(`catalog unreachable:${err.cause?.code || err.message}`);
    e.statusCode = 502;
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`catalog album ${res.status}: ${text.slice(0, 200)}`);
    err.statusCode = res.status === 404 ? 404 : 502;
    throw err;
  }
  const body = await res.json().catch((err) => {
    console.warn('[albums] json parse failed:', err.message);
    return null;
  });
  if (!body || typeof body !== 'object' || !body.id) {
    const err = new Error('album not found');
    err.statusCode = 404;
    throw err;
  }

  const info = body.more_info ?? {};
  const tracks = (body?.songs ?? body?.list ?? [])
    .map(mapSong)
    .filter(t => t.id && t.streamUrl);
  const desc = decodeEntities(body.header_desc ?? '');
  const detail = {
    id:         body.id,
    name:       decodeEntities(body.title ?? body.name ?? ''),
    image:      pickImageUrl(body.image),
    year:       body.year ?? null,
    language:   body.language ?? null,
    artist:     decodeEntities(body.subtitle ?? info.artistMap?.primary_artists?.[0]?.name ?? ''),
    subtitle:   desc,
    isMovie:    /\bfilm\b/i.test(desc),
    trackCount: tracks.length,
    tracks,
  };

  albumCache.set(albumId, detail);
  if (tracks.length) cacheTracks(tracks);
  return detail;
}

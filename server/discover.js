// Daily-cached catalog discovery (trending + popular playlists + multiple
// search-backed shelves). One catalog home call + several curated searches per
// language per day, cached in-memory until the date rolls over.

import { getCatalogHome, searchSongs, getSongDetails } from './catalog.js';
import { normalizeTitle } from './related.js';

// A search-backed shelf ("telugu top hits 2026" etc.) can carry the same song
// several times: the provider returns it under different ids, title variants
// ("... (From "Movie")") and even different artist credits (a singer vs a
// label), so searchSongs' title|artist dedupe lets the credit-variant dupes
// through. Collapse each shelf by NORMALIZED TITLE so a song shows once.
function dedupeByTitle(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks ?? []) {
    if (!t) continue;
    const key = normalizeTitle(t.title) || t.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// Dynamic query builders — year + month auto-update so we never go stale.
// Classics stay static (timeless catalog, not time-bound).
function nowParts() {
  const d = new Date();
  return {
    year:      d.getUTCFullYear(),
    monthName: d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase(),
  };
}

function movieQuery(lang) {
  const { year, monthName } = nowParts();
  return ({
    tamil:     `new tamil movie songs ${monthName} ${year}`,
    english:   `new movie soundtracks ${year}`,
    hindi:     `new bollywood movie songs ${monthName} ${year}`,
    malayalam: `new malayalam movie songs ${year}`,
    kannada:   `new kannada movie songs ${year}`,
    telugu:    `new telugu movie songs ${monthName} ${year}`,
  })[lang];
}

function hitsQuery(lang) {
  const { year } = nowParts();
  return ({
    tamil:     `tamil top hits ${year}`,
    english:   `top hits ${year}`,
    hindi:     `hindi top hits ${year}`,
    malayalam: `malayalam top hits ${year}`,
    kannada:   `kannada top hits ${year}`,
    telugu:    `telugu top hits ${year}`,
  })[lang];
}

const CLASSIC_QUERIES = {
  tamil:     'ar rahman classics',
  english:   'classic rock hits',
  hindi:     'lata mangeshkar classics',
  malayalam: 'malayalam classics',
  kannada:   'kannada classic songs',
  telugu:    'telugu classic songs',
};

function dateSeed() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

let cachedSeed = null;
const discoverCache = new Map();

function cacheForToday() {
  const seed = dateSeed();
  if (seed !== cachedSeed) {
    discoverCache.clear();
    cachedSeed = seed;
  }
  return discoverCache;
}

function searchOrEmpty(q, lang) {
  return q ? searchSongs(q, { lang, limit: 12 }).then(enrichImages) : Promise.resolve([]);
}

// The catalog's search for compilation-flavored queries ("tamil top hits
// 2026") often tags every track with the compilation's playlist cover so all
// the cards in a shelf look identical. The per-song detail call returns each
// song's individual primary image, so we refresh in a single batched call.
async function enrichImages(tracks) {
  if (!tracks || tracks.length === 0) return tracks;
  try {
    const ids = tracks.map(t => t.id).filter(Boolean);
    if (ids.length === 0) return tracks;
    const detailed = await getSongDetails(ids);
    const byId = new Map(detailed.map(d => [d.id, d]));
    return tracks.map(t => {
      const d = byId.get(t.id);
      return d?.imageUrl ? { ...t, imageUrl: d.imageUrl } : t;
    });
  } catch {
    return tracks;
  }
}

export async function getDiscoverHome({ lang } = {}) {
  const cache = cacheForToday();
  const key = lang ?? 'all';
  const cached = cache.get(key);
  if (cached) return cached;

  const [homeRes, movieRes, hitsRes, classicsRes] = await Promise.allSettled([
    getCatalogHome({ lang }),
    searchOrEmpty(lang && movieQuery(lang),      lang),
    searchOrEmpty(lang && hitsQuery(lang),       lang),
    searchOrEmpty(lang && CLASSIC_QUERIES[lang], lang),
  ]);

  const trending = homeRes.status === 'fulfilled' ? await enrichImages(homeRes.value.trending) : [];
  const result = {
    trending:         dedupeByTitle(trending),
    popularPlaylists: homeRes.status     === 'fulfilled' ? homeRes.value.featuredPlaylists       : [],
    topHits:          dedupeByTitle(hitsRes.status     === 'fulfilled' ? hitsRes.value     : []),
    classics:         dedupeByTitle(classicsRes.status === 'fulfilled' ? classicsRes.value : []),
    movieSongs:       dedupeByTitle(movieRes.status    === 'fulfilled' ? movieRes.value    : []),
  };
  cache.set(key, result);
  return result;
}

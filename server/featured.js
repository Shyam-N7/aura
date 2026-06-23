// Curated featured-tracks source. Each day picks 3-of-6 queries per language
// using a date seed, so a reload during the day returns the same set, but
// tomorrow's set is different. In-memory cache keyed by language flushes when
// the date rolls over.

import { searchSongs } from './catalog.js';

// Queries are built dynamically so year-tagged ones auto-update each calendar
// year. Artist-only queries (no year) stay reliable across all dates.
const STATIC_QUERIES = {
  tamil:     ['sid sriram tamil', 'anirudh tamil', 'santhosh narayanan'],
  english:   ['lana del rey', 'arctic monkeys', 'phoebe bridgers', 'the lumineers', 'hozier'],
  hindi:     ['pritam hindi', 'amit trivedi hindi', 'shreya ghoshal', 'sanam puri'],
  malayalam: ['thaikkudam bridge', 'vineeth sreenivasan', 'sushin shyam', 'gopi sundar malayalam', 'kappa tv'],
  kannada:   ['vasuki vaibhav', 'sonu nigam kannada', 'raghu dixit', 'masala coffee', 'rakshit shetty kannada'],
};

function yearQueries(lang, year) {
  return ({
    tamil:     [`ar rahman tamil ${year}`, `tamil hits ${year}`, `tamil melody ${year}`],
    english:   [`indie folk ${year}`],
    hindi:     [`arijit singh ${year}`, `bollywood hits ${year}`],
    malayalam: [`malayalam hits ${year}`],
    kannada:   [`kannada hits ${year}`],
  })[lang] ?? [];
}

function queriesFor(lang) {
  const year = new Date().getUTCFullYear();
  return [...yearQueries(lang, year), ...(STATIC_QUERIES[lang] ?? [])];
}

const ALL_LANGS = Object.keys(STATIC_QUERIES);

function dateSeed() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

// Cheap string hash for the daily picker.
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Deterministic shuffle: same seed → same order. Linear congruential generator
// stepped per swap; good enough for picking 3-of-6 each day.
function pickDaily(arr, n, seed) {
  const a = [...arr];
  let h = hash(seed);
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) | 0;
    const j = Math.abs(h) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Cache for (lang → tracks) at the current date. Flushes when the date rolls.
let cachedSeed = null;
const dailyCache = new Map();

function dailyCacheForToday() {
  const seed = dateSeed();
  if (seed !== cachedSeed) {
    dailyCache.clear();
    cachedSeed = seed;
  }
  return dailyCache;
}

async function fetchForLang(lang, perQuery = 6) {
  const cache = dailyCacheForToday();
  const cached = cache.get(lang);
  if (cached) return cached;

  const all = queriesFor(lang);
  const picks = pickDaily(all, 3, `${cachedSeed}|${lang}`);
  const batches = await Promise.allSettled(
    picks.map(q => searchSongs(q, { limit: perQuery, lang })),
  );
  const tracks = batches.flatMap(b => b.status === 'fulfilled' ? b.value : []);
  cache.set(lang, tracks);
  return tracks;
}

function dedupe(tracks) {
  const seen = new Map();
  for (const t of tracks) {
    if (!t?.id) continue;
    if (!seen.has(t.id)) seen.set(t.id, t);
  }
  return [...seen.values()];
}

function interleave(buckets) {
  const out = [];
  const maxLen = Math.max(...buckets.map(b => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const b of buckets) {
      if (b[i]) out.push(b[i]);
    }
  }
  return out;
}

// Per-user-per-mode pool cache (seeded modes only; `everyday`/no-seed stays on
// the global dailyCache, so the default has no per-user fan-out). MRU-capped.
const modeCache = new Map();
const MODE_CACHE_MAX = 200;

// A mode's pool: each real seed artist's songs, interleaved so the top is a mix
// (not all of one artist), then deduped/filtered by the caller. No lang filter —
// a mode's artists deliberately span languages; the artist IS the seed.
async function fetchForSeedArtists(seedArtists, perArtist = 8) {
  const batches = await Promise.allSettled(
    seedArtists.map(a => searchSongs(a, { limit: perArtist })),
  );
  const buckets = batches.map(b => (b.status === 'fulfilled' ? dedupe(b.value) : []));
  return interleave(buckets);
}

export async function getFeatured({ lang, limit = 20, seedArtists, modeKey, userId } = {}) {
  // A seeded mode → its own per-user/mode pool, cached for the day. `everyday`
  // (no seed) falls through to the unchanged global default below.
  if (Array.isArray(seedArtists) && seedArtists.length) {
    const key = `${userId || 'anon'}|${modeKey || 'mode'}|${dateSeed()}`;
    let tracks = modeCache.get(key);
    if (!tracks) {
      tracks = dedupe(await fetchForSeedArtists(seedArtists)).filter(t => t.streamUrl);
      modeCache.delete(key);          // MRU: re-insert at the end
      modeCache.set(key, tracks);
      if (modeCache.size > MODE_CACHE_MAX) modeCache.delete(modeCache.keys().next().value);
    }
    return tracks.slice(0, limit);
  }
  if (lang && STATIC_QUERIES[lang]) {
    const tracks = dedupe(await fetchForLang(lang));
    return tracks.filter(t => t.streamUrl).slice(0, limit);
  }
  // No lang or unknown lang: interleave across all languages so the top of the
  // list is a mix, not all of one then all of another.
  const perLang = await Promise.all(
    ALL_LANGS.map(L => fetchForLang(L, 4).then(dedupe)),
  );
  return interleave(perLang).filter(t => t.streamUrl).slice(0, limit);
}

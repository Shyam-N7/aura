// Mood-bridge curation: given a from-mood and a to-mood, return N tracks that
// transition between them. v1 is intentionally simple — curated catalog search
// per mood, first half plays from-mood tracks, second half plays to-mood
// tracks. Real energy/valence interpolation is Phase IV.

import { searchSongs, dedupeSongs } from './catalog.js';

const MOOD_QUERIES = {
  restless: 'soft acoustic indie',
  focused:  'instrumental focus music',
  calm:     'melancholy indie songs',
  upbeat:   'upbeat dance hits',
  warm:     'romantic ballads',
  social:   'party hits',
};

export const MOODS = Object.keys(MOOD_QUERIES);

function dateSeed() {
  return new Date().toISOString().slice(0, 10);
}

let cachedSeed = null;
const cache = new Map(); // key: `${from}|${to}|${steps}` → tracks

function cacheForToday() {
  const seed = dateSeed();
  if (seed !== cachedSeed) {
    cache.clear();
    cachedSeed = seed;
  }
  return cache;
}

export async function getBridgeTracks({ from, to, steps = 5 } = {}) {
  if (!MOOD_QUERIES[from] || !MOOD_QUERIES[to]) {
    const err = new Error('unknown mood');
    err.statusCode = 400;
    throw err;
  }
  const key = `${from}|${to}|${steps}`;
  const c = cacheForToday();
  const cached = c.get(key);
  if (cached) return cached;

  const fromCount = Math.ceil(steps / 2);
  const toCount   = steps - fromCount;
  const overshoot = 3; // fetch extra to survive dedup + missing streamUrl

  const [fromRes, toRes] = await Promise.allSettled([
    searchSongs(MOOD_QUERIES[from], { limit: fromCount + overshoot }),
    searchSongs(MOOD_QUERIES[to],   { limit: toCount   + overshoot }),
  ]);
  const fromTracks = (fromRes.status === 'fulfilled' ? fromRes.value : [])
    .filter(t => t.streamUrl);
  const toTracks   = (toRes.status   === 'fulfilled' ? toRes.value   : [])
    .filter(t => t.streamUrl);

  // Dedupe across both buckets so a song shared by both moods doesn't repeat.
  const sequence = dedupeSongs([
    ...fromTracks.slice(0, fromCount),
    ...toTracks.slice(0,   toCount),
  ]).slice(0, steps);

  c.set(key, sequence);
  return sequence;
}

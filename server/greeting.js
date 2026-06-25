// Greeting cache. Keyed by (mood, hour); each unique key fires Gemini once.
// 1-hour TTL means a greeting written at 9pm is reused until 10pm; same mood
// + same hour next day reuses the cached line (intentional — saves API quota).
//
// The cache key is BOUNDED on both axes so an unauthenticated caller can't bypass
// it: mood is validated against the known vocabulary (unknown → 'any') and hour is
// clamped to 0–23. The Map is also size-capped (LRU-ish) so it can't grow without
// limit. Combined with the costLimiter on the route, this closes the spend +
// memory-growth vector. (security: H1)

import { generateGreeting } from './prompts/greeting.js';
import { normalizeMood } from './moods.js';

const cache = new Map();
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 200;

function cacheKey(mood, hour) {
  return `${mood}|${hour}`;
}

function clampHour(hour) {
  const h = Number(hour);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : new Date().getHours();
}

export async function getGreeting({ mood, trackCount, languages, hour }) {
  const safeMood = normalizeMood(mood);
  const safeHour = clampHour(hour);
  const key = cacheKey(safeMood, safeHour);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.payload;

  const payload = await generateGreeting({
    mood: safeMood === 'any' ? undefined : safeMood,
    trackCount,
    languages,
    hour: safeHour,
  });

  // Bounded insert: evict the oldest entry once we're at the cap (Map preserves
  // insertion order), so the cache can never grow without limit.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { payload, fetchedAt: Date.now() });
  return payload;
}

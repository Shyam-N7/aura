// Greeting cache. Keyed by (mood, hour); each unique key fires Gemini once.
// 1-hour TTL means a greeting written at 9pm is reused until 10pm; same mood
// + same hour next day reuses the cached line (intentional — saves API quota).

import { generateGreeting } from './prompts/greeting.js';

const cache = new Map();
const TTL_MS = 60 * 60 * 1000;

function cacheKey(mood, hour) {
  return `${mood ?? 'any'}|${hour}`;
}

export async function getGreeting({ mood, trackCount, languages, hour }) {
  const key = cacheKey(mood, hour);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return hit.payload;
  }
  const payload = await generateGreeting({ mood, trackCount, languages, hour });
  cache.set(key, { payload, fetchedAt: Date.now() });
  return payload;
}

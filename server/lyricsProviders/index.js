// The synced-lyrics provider chain. Ordered LRCLIB → Musixmatch → NetEase:
// cleanest license first, then the regional-coverage workhorse (Musixmatch, the
// big win for this Indian-heavy catalog), then long-tail mop-up. The first
// synced hit that passes the duration sanity check wins. Musixmatch + NetEase are
// opt-in (see their files) and return null when unconfigured, so the chain
// degrades to LRCLIB-only with no errors.

import * as lrclib from './lrclib.js';
import * as musixmatch from './musixmatch.js';
import * as netease from './netease.js';
import { passesQuality } from './util.js';

export { parseLRC } from './util.js';

const SYNCED_PROVIDERS = [lrclib, musixmatch, netease];

// Returns { lines: [{t, line}], source } from the first provider that has a
// usable synced match, or null if none do.
export async function getSyncedLyrics({ artist, title, durationSec }) {
  if (!artist || !title) return null;
  for (const provider of SYNCED_PROVIDERS) {
    try {
      const hit = await provider.fetchSynced({ artist, title, durationSec });
      if (hit?.lines?.length && passesQuality(hit.lines, durationSec)) {
        return hit;
      }
    } catch (err) {
      // AbortError = our own timeout firing; anything else is a provider hiccup.
      // Either way, move on to the next provider.
      if (err.name !== 'AbortError') {
        console.warn(`[lyrics] ${provider.name} failed:`, err.message);
      }
    }
  }
  return null;
}

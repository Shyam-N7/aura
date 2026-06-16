// LRCLIB synced-lyrics provider. Free, open, no key — querying by artist + title
// (+ duration, which sharpens matching across covers/remixes/live versions). We
// only return SYNCED lyrics here; LRCLIB's plainLyrics is intentionally ignored
// because the app shows synced-only (plain text is sourced separately for the
// generation worker, never displayed).

import { LYRICS_API_BASE, LYRICS_USER_AGENT, LYRICS_TIMEOUT_MS } from '../config.js';
import { fetchWithTimeout, parseLRC } from './util.js';

export const name = 'lrclib';

export async function fetchSynced({ artist, title, durationSec }) {
  const url = new URL(LYRICS_API_BASE);
  url.searchParams.set('artist_name', artist);
  url.searchParams.set('track_name',  title);
  if (durationSec) url.searchParams.set('duration', String(durationSec));
  // The provider wants an identifiable UA — a generic browser UA sometimes 429s.
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': LYRICS_USER_AGENT },
    ms: LYRICS_TIMEOUT_MS,
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body?.syncedLyrics) return null;
  const lines = parseLRC(body.syncedLyrics);
  return lines.length ? { lines, source: 'lrc' } : null;
}

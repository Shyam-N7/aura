// NetEase Cloud Music synced-lyrics provider — long-tail mop-up (helps some
// English/CJK tracks; weak for Indian regional, hence last in the chain).
//
// OPT-IN: activates only when NETEASE_API_BASE points at a NeteaseCloudMusicApi
// instance (github.com/Binaryify/NeteaseCloudMusicApi — self-host on Vercel/etc.).
// There is no stable first-party public endpoint, so this stays off unless
// configured. Two hops: search for the song, then fetch its LRC.

import { NETEASE_API_BASE, LYRICS_TIMEOUT_MS } from '../config.js';
import { fetchWithTimeout, parseLRC } from './util.js';

export const name = 'netease';

export async function fetchSynced({ artist, title, durationSec }) {
  if (!NETEASE_API_BASE) return null;   // provider disabled — skip silently

  const searchUrl = new URL('search', NETEASE_API_BASE);
  searchUrl.searchParams.set('keywords', `${title} ${artist}`);
  searchUrl.searchParams.set('limit', '5');
  const sres = await fetchWithTimeout(searchUrl, { ms: LYRICS_TIMEOUT_MS });
  if (!sres.ok) return null;
  const songs = (await sres.json().catch(() => null))?.result?.songs;
  if (!Array.isArray(songs) || songs.length === 0) return null;

  // Prefer the result whose duration (ms) is closest to ours — NetEase search is
  // fuzzy and the top hit is often a cover/remix of the wrong length.
  let song = songs[0];
  if (durationSec) {
    const target = durationSec * 1000;
    const dist = (s) => Math.abs((typeof s.duration === 'number' ? s.duration : Infinity) - target);
    song = songs.reduce((best, s) => (dist(s) < dist(best) ? s : best), songs[0]);
  }
  if (!song?.id) return null;

  const lyricUrl = new URL('lyric', NETEASE_API_BASE);
  lyricUrl.searchParams.set('id', String(song.id));
  const lres = await fetchWithTimeout(lyricUrl, { ms: LYRICS_TIMEOUT_MS });
  if (!lres.ok) return null;
  const lrc = (await lres.json().catch(() => null))?.lrc?.lyric;
  if (!lrc) return null;

  const lines = parseLRC(lrc);
  return lines.length ? { lines, source: 'netease' } : null;
}

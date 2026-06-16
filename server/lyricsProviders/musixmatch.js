// Musixmatch synced-lyrics provider — the biggest coverage win for this catalog
// (best-in-class for Indian regional film music, which LRCLIB largely lacks).
//
// OPT-IN: activates only when MUSIXMATCH_USERTOKEN is set; otherwise returns null
// and the chain skips it. Uses the community "usertoken" against the desktop
// endpoint. NOTE (ToS): that endpoint is not licensed for third-party
// redistribution — a gray area, and the token can be revoked or rate-limited at
// any time. Treat it as best-effort enrichment; the compliant path is the
// official Musixmatch API. See .env.example.

import { MUSIXMATCH_USERTOKEN, MUSIXMATCH_API_BASE, MUSIXMATCH_TIMEOUT_MS } from '../config.js';
import { fetchWithTimeout, parseLRC } from './util.js';

export const name = 'musixmatch';

export async function fetchSynced({ artist, title, durationSec }) {
  if (!MUSIXMATCH_USERTOKEN) return null;   // provider disabled — skip silently

  const url = new URL('macro.subtitles.get', MUSIXMATCH_API_BASE);
  url.searchParams.set('format', 'json');
  url.searchParams.set('namespace', 'lyrics_richsynched');
  url.searchParams.set('subtitle_format', 'lrc');
  url.searchParams.set('app_id', 'web-desktop-app-v1.0');
  url.searchParams.set('usertoken', MUSIXMATCH_USERTOKEN);
  url.searchParams.set('q_track', title);
  url.searchParams.set('q_artist', artist);
  if (durationSec) {
    url.searchParams.set('q_duration', String(durationSec));
    url.searchParams.set('f_subtitle_length', String(durationSec));
  }

  const res = await fetchWithTimeout(url, {
    ms: MUSIXMATCH_TIMEOUT_MS,
    headers: {
      // The desktop endpoint expects a desktop UA + a (possibly empty) token
      // cookie; a bare request is often rejected.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': 'x-mxm-token-guid=',
    },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);

  // macro.subtitles.get nests the real result under macro_calls. Navigate
  // defensively — any missing hop (no match, error status) yields undefined.
  const macro   = body?.message?.body?.macro_calls;
  const subCall = macro?.['track.subtitles.get'];
  if (subCall?.message?.header?.status_code !== 200) return null;
  const lrc = subCall?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
  if (!lrc) return null;

  const lines = parseLRC(lrc);
  return lines.length ? { lines, source: 'musixmatch' } : null;
}

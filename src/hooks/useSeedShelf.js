import { useEffect, useMemo, useState } from 'react';
import { getArtist } from '../api/artists';
import { getSeedArtists } from '../lib/onboarding';

// In-memory cache keyed by the joined seed-name list, so navigating away
// + back to DesktopHome reads cached tracks synchronously instead of
// re-fetching every artist and staggering the shelf back in.
const _cache = {};

// Loads up to ~9 tracks pulled from the user's onboarding-picked artists
// (3 tracks per pick). Returns `{ tracks, status }`. Silently returns
// empty when there are no seeds. Status starts as 'idle' and only flips
// while a fetch is in flight; failures fall back to whatever the
// promise pool returned (often partial — fine).
export function useSeedShelf(enabled = true) {
  // Read seeds synchronously so we never call setState just to "clear" the
  // shelf — empty seeds → empty list, no effect run.
  const seeds = useMemo(() => (enabled ? getSeedArtists() : []), [enabled]);
  const cacheKey = useMemo(() => seeds.map(s => s.name).join('|'), [seeds]);
  const [tracks, setTracks] = useState(() => _cache[cacheKey]?.tracks ?? []);
  const [status, setStatus] = useState(() => (
    _cache[cacheKey]?.status ?? (seeds.length === 0 ? 'idle' : 'loading')
  ));

  useEffect(() => {
    if (seeds.length === 0) return undefined;
    // Cache hit — already fetched in a prior mount; skip the network roundtrip.
    if (_cache[cacheKey]) return undefined;
    const ctl = new AbortController();
    Promise.allSettled(
      seeds.map(s => getArtist({ name: s.name, trackId: s.sampleTrackId }, { signal: ctl.signal })),
    ).then(results => {
      if (ctl.signal.aborted) return;
      // Interleave top tracks (3 per artist) so the shelf cycles through the
      // user's picks rather than blasting one artist's catalog up front.
      const perArtist = results.map(r =>
        (r.status === 'fulfilled' && r.value?.topTracks) ? r.value.topTracks.slice(0, 3) : []);
      const max = Math.max(0, ...perArtist.map(a => a.length));
      const interleaved = [];
      for (let i = 0; i < max; i++) {
        for (const list of perArtist) if (list[i]) interleaved.push(list[i]);
      }
      const seen = new Set();
      const deduped = interleaved.filter(t => {
        if (!t?.id || seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      setTracks(deduped);
      // Distinguish "fetched but no tracks" from "every fetch failed" — the
      // old 'ok' on both made it impossible to tell why the shelf was empty.
      const nextStatus =
        deduped.length > 0                              ? 'ok'    :
        results.every(r => r.status === 'rejected')     ? 'error' :
                                                          'empty';
      setStatus(nextStatus);
      _cache[cacheKey] = { tracks: deduped, status: nextStatus };
    });
    return () => ctl.abort();
  }, [seeds, cacheKey]);

  return { tracks, status };
}

import { useEffect, useState } from 'react';
import { getRelated } from '../../api/related';

// Shared "more like this" fetch — the related-songs shelf (RailExtras) and the
// phone/tablet player carousel (MoreLikeThisCarousel) both consume this so the
// fetch lives in exactly one place. Keyed by trackId with AbortController
// cleanup; `tracks` stays null until the first resolve.
//   status: 'loading' | 'ok' | 'error'
export function useRelated(trackId, lang) {
  const [hit, setHit] = useState({ trackId: null, tracks: null, error: null });

  useEffect(() => {
    if (!trackId) return undefined;
    const ctl = new AbortController();
    getRelated(trackId, { lang, signal: ctl.signal })
      .then(tracks => setHit({ trackId, tracks, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ trackId, tracks: null, error: err.message });
      });
    return () => ctl.abort();
  }, [trackId, lang]);

  // A result is only "current" once it matches the requested trackId — while a
  // newer track's fetch is in flight we report 'loading', not the stale hit.
  const status = hit.trackId === trackId
    ? (hit.error ? 'error' : hit.tracks ? 'ok' : 'loading')
    : 'loading';

  return { status, tracks: hit.tracks, error: hit.error };
}

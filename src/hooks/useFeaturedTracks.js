import { useCallback, useEffect, useState } from 'react';
import { getFeatured } from '../api/catalog';

// Loads a featured-tracks pool once (per `lang`) and exposes it as
// { tracks, status, error, refetch }. Status follows the derived-state pattern
// used by SearchScreen so we don't synchronously setState inside the effect body.
// `refetch` bumps an internal nonce so the effect re-runs.
export function useFeaturedTracks({ lang, limit = 20, mode } = {}) {
  const [hit, setHit] = useState({ key: '', tracks: [], error: null });
  const [nonce, setNonce] = useState(0);
  // `mode` isn't a query param (the server reads the active mode from the auth
  // token) — it's in the key so switching modes refetches the re-seeded pool.
  const key = `${lang ?? 'all'}|${limit}|${mode ?? ''}|${nonce}`;
  const status = hit.key === key
    ? (hit.error ? 'error' : 'ok')
    : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getFeatured({ lang, limit, signal: ctl.signal })
      .then(tracks => setHit({ key, tracks, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ key, tracks: [], error: err.message });
      });
    return () => ctl.abort();
  }, [lang, limit, mode, key]);

  const refetch = useCallback(() => setNonce(n => n + 1), []);
  return { tracks: hit.tracks, status, error: hit.error, refetch };
}

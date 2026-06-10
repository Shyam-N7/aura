import { useEffect, useRef } from 'react';
import { parsePath, buildPath } from '../lib/routes';

// Two-way sync between the app's route state and `location.pathname`. Uses a
// ref to mark URL-originated changes so the write-effect doesn't echo them back.
//
// `apply` receives a parsed `{ screen, artistKey?, detailPlaylistId?, ... }`
// payload; App.jsx is responsible for mapping that into setState calls.
// `current` is the current app state, watched so we can mirror to the URL.
export function usePathRoute({ apply, current, enabled = true }) {
  // True while we're applying a URL to state — suppresses the state→path
  // mirror until the React render settles, so we don't write a duplicate
  // URL update.
  const fromPathRef = useRef(false);

  // path → state (popstate: browser back/forward or a manual URL edit)
  useEffect(() => {
    if (!enabled) return undefined;
    const onPop = () => {
      const parsed = parsePath(window.location.pathname);
      fromPathRef.current = true;
      apply(parsed);
      // Allow the next state→path effect to run normally.
      queueMicrotask(() => { fromPathRef.current = false; });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [enabled, apply]);

  // state → path. Explicit deps (rather than running every render) avoid
  // burning a buildPath + equality check on every parent re-render —
  // chat input keystrokes etc. used to fire this effect through App.jsx.
  const { screen, artistKey, detailPlaylistId, catalogPlaylistId, albumId, hubLang } = current ?? {};
  useEffect(() => {
    if (!enabled) return;
    if (fromPathRef.current) return;
    const next = buildPath({ screen, artistKey, detailPlaylistId, catalogPlaylistId, albumId, hubLang });
    if (next !== window.location.pathname) {
      // replaceState (not pushState) keeps parity with the old hash router:
      // in-app navigation never adds history entries, so the browser Back
      // button leaves the app exactly as it did before. replaceState fires no
      // popstate, so this can't loop through the listener above. Note: any
      // ?query on the URL is dropped at the first in-app navigation (none are
      // used in-app today; /auth?mode=signup lives pre-auth).
      window.history.replaceState(null, '', next);
    }
    // artistKey itself isn't a stable dep — we track its fields explicitly so
    // a new object reference with identical id+name doesn't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, screen, artistKey?.id, artistKey?.name, detailPlaylistId, catalogPlaylistId, albumId, hubLang]);
}

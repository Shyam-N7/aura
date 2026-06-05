import { useEffect, useRef } from 'react';
import { parseHash, buildHash } from '../lib/routes';

// Two-way sync between the app's route state and `location.hash`. Uses a ref
// to mark hash-originated changes so the write-effect doesn't echo them back.
//
// `apply` receives a parsed `{ screen, artistKey?, detailPlaylistId?, ... }`
// payload; App.jsx is responsible for mapping that into setState calls.
// `current` is the current app state, watched so we can mirror to the URL.
export function useHashRoute({ apply, current, enabled = true }) {
  // True while we're applying a hash to state — suppresses the state→hash
  // mirror until the React render settles, so we don't push a duplicate
  // history entry.
  const fromHashRef = useRef(false);

  // hash → state
  useEffect(() => {
    if (!enabled) return undefined;
    const onHash = () => {
      const parsed = parseHash(window.location.hash);
      fromHashRef.current = true;
      apply(parsed);
      // Allow the next state→hash effect to run normally.
      queueMicrotask(() => { fromHashRef.current = false; });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [enabled, apply]);

  // state → hash. Explicit deps (rather than running every render) avoid
  // burning a buildHash + equality check on every parent re-render —
  // chat input keystrokes etc. used to fire this effect through App.jsx.
  const { screen, artistKey, detailPlaylistId, catalogPlaylistId, hubLang } = current ?? {};
  useEffect(() => {
    if (!enabled) return;
    if (fromHashRef.current) return;
    const next = buildHash({ screen, artistKey, detailPlaylistId, catalogPlaylistId, hubLang });
    const have = window.location.hash || '#/';
    if (next !== have) {
      // replaceState avoids polluting browser history for transient state
      // changes — only deep links the user navigated to via the app itself
      // push real entries. Simpler choice: always replace for now; we can
      // upgrade to push later once we know which transitions deserve a
      // history entry.
      window.history.replaceState(null, '', next);
    }
    // artistKey itself isn't a stable dep — we track its fields explicitly so
    // a new object reference with identical id+name doesn't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, screen, artistKey?.id, artistKey?.name, detailPlaylistId, catalogPlaylistId, hubLang]);
}

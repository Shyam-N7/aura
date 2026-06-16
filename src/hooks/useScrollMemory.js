import { useEffect, useLayoutEffect, useRef } from 'react';
import { getScroll, setScroll } from '../lib/scrollMemory';
import {
  registerActiveScroll, unregisterActiveScroll, emitActiveScroll, resetActiveScroll,
} from '../lib/activeScroll';

// Remembers and restores a scroll container's position across navigation.
// Attach the returned ref to the element that actually scrolls (the
// `overflow-y:auto` root of a screen). Pass a stable `key` per screen+entity
// (e.g. `album|abc123`) and, for screens whose content loads async, a `ready`
// flag so we only restore once the content height is correct (no clamp, no
// flash). A passive scroll listener keeps the stored position current, so
// leaving the screen needs no explicit save — the store always holds the last
// value before unmount. It also feeds the app-level active-scroll signal that
// drives the mobile bottom bar's back-to-top morph.
export function useScrollMemory(key, { ready = true } = {}) {
  const ref = useRef(null);
  // Live key for the (mount-only) scroll listener, so re-keying doesn't re-bind.
  const keyRef = useRef(key);
  keyRef.current = key;
  // Set while the restore below assigns scrollTop, so the single 'scroll' event
  // that assignment fires is swallowed (never reported as the user scrolling).
  const suppress = useRef(false);

  // Record the latest scroll position, register as the active scroll container,
  // and report USER scrolling up to app-level chrome. Mount-only on purpose: the
  // element is stable across `key` changes (refining a search query, switching
  // album/artist in place), so re-keying never churns registration or flickers
  // the back-to-top morph — the listener reads the live key via keyRef.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    registerActiveScroll(el);
    const onScroll = () => {
      const k = keyRef.current;
      if (k) setScroll(k, el.scrollTop);
      if (suppress.current) { suppress.current = false; return; }   // restore-driven scroll → ignore
      emitActiveScroll(el, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); unregisterActiveScroll(el); };
  }, []);

  // Restore before paint (so there's no visible jump). Runs on mount and again
  // when `ready` flips true or the key changes; an unknown key restores to 0, so
  // genuinely new navigations land at the top. Arriving — even scrolled deep —
  // should read as "top" for the chrome (the morph is for active scrolling), so
  // reset the morph and swallow the scroll event the assignment fires.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ready || !key) return;
    const saved = getScroll(key);
    const max = el.scrollHeight - el.clientHeight;
    const target = max > 0 ? Math.min(saved, max) : 0;
    if (Math.abs(target - el.scrollTop) > 1) suppress.current = true;
    el.scrollTop = target;
    resetActiveScroll(el);
  }, [key, ready]);

  return ref;
}

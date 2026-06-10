import { useEffect, useLayoutEffect, useRef } from 'react';
import { getScroll, setScroll } from '../lib/scrollMemory';

// Remembers and restores a scroll container's position across navigation.
// Attach the returned ref to the element that actually scrolls (the
// `overflow-y:auto` root of a screen). Pass a stable `key` per screen+entity
// (e.g. `album|abc123`) and, for screens whose content loads async, a `ready`
// flag so we only restore once the content height is correct (no clamp, no
// flash). A passive scroll listener keeps the stored position current, so
// leaving the screen needs no explicit save — the store always holds the last
// value before unmount.
export function useScrollMemory(key, { ready = true } = {}) {
  const ref = useRef(null);

  // Continuously record the latest scroll position into the module-scope store.
  useEffect(() => {
    const el = ref.current;
    if (!el || !key) return undefined;
    const onScroll = () => setScroll(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [key]);

  // Restore before paint (so there's no visible jump). Runs on mount and again
  // when `ready` flips true or the key changes; an unknown key restores to 0, so
  // genuinely new navigations land at the top.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ready || !key) return;
    const saved = getScroll(key);
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = max > 0 ? Math.min(saved, max) : 0;
  }, [key, ready]);

  return ref;
}

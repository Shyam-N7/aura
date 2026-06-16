import { useEffect, useRef, useState } from 'react';
import { subscribeActiveScroll, scrollActiveToTop } from '../lib/activeScroll';

const THRESHOLD = 480;   // px scrolled before the bar offers "back to top"
const IDLE_MS   = 2500;  // revert this long after the last scroll movement

// App-level signal for the bottom bar's back-to-top morph: `scrolled` is true
// while the active screen is past THRESHOLD and still moving, and flips back
// IDLE_MS after the last scroll (so the nav bar returns when you stop) or
// immediately once you're back near the top. `toTop` scrolls the active screen.
export function useActiveScroll() {
  const [scrolled, setScrolled] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    const onScroll = (top) => {
      clearTimeout(timer.current);
      if (top > THRESHOLD) {
        setScrolled(true);
        timer.current = setTimeout(() => setScrolled(false), IDLE_MS);
      } else {
        setScrolled(false);
      }
    };
    const unsub = subscribeActiveScroll(onScroll);
    return () => { unsub(); clearTimeout(timer.current); };
  }, []);

  return { scrolled, toTop: scrollActiveToTop };
}

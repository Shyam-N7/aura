// Tick-on-the-minute clock. Returns the current Date, re-renders every minute
// (aligned to the wall-clock minute boundary so the displayed minute matches
// the system clock). Also re-syncs whenever the tab regains visibility, in
// case a backgrounded browser tab throttled or paused the interval.

import { useEffect, useState } from 'react';

export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval;
    let firstTick;
    const tick = () => setNow(new Date());

    // Align the first tick to the next wall-clock minute boundary.
    const msUntilMinute = intervalMs - (Date.now() % intervalMs);
    firstTick = setTimeout(() => {
      tick();
      interval = setInterval(tick, intervalMs);
    }, msUntilMinute);

    // Browsers throttle/pause timers on hidden tabs. When the tab comes back
    // we tick immediately so the displayed time isn't stale.
    const onVisibility = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', tick);

    return () => {
      clearTimeout(firstTick);
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', tick);
    };
  }, [intervalMs]);

  return now;
}

const SHORT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LONG_DAYS  = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export function formatTime12(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatTime24(d) {
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatShortStamp(d) {
  return `${SHORT_DAYS[d.getDay()]} · ${formatTime12(d)}`;
}

export function formatLongStamp(d) {
  return `${LONG_DAYS[d.getDay()]} · ${formatTime12(d).toUpperCase()}`;
}

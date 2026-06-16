// Tracks the currently-visible screen's scroll container so app-level chrome
// (the mobile bottom bar) can react to scrolling — without every screen having
// to thread a callback up to App. The active screen registers its scroll element
// through useScrollMemory; the bar subscribes via useActiveScroll. Only one
// screen is on-screen at a time, so "last registrant wins". The chrome resets to
// its top state (a broadcast of 0) whenever the active screen changes, leaves,
// or restores its scroll position — so the back-to-top morph only ever appears
// from genuine user scrolling, never on passive arrival.

let activeEl = null;
const subs = new Set();   // each: (scrollTop: number) => void

export function registerActiveScroll(el) {
  if (!el || el === activeEl) { activeEl = el; return; }
  activeEl = el;
  subs.forEach(fn => fn(0));   // new screen → reset chrome to the top state
}

export function unregisterActiveScroll(el) {
  if (activeEl !== el) return;
  activeEl = null;
  subs.forEach(fn => fn(0));   // active screen left → collapse the morph immediately
}

// Arrival / scroll-restore: the screen is back (even scrolled deep), but the
// user isn't actively scrolling, so the chrome should read "top".
export function resetActiveScroll(el) {
  if (el === activeEl) subs.forEach(fn => fn(0));
}

export function emitActiveScroll(el, top) {
  if (el === activeEl) subs.forEach(fn => fn(top));
}

export function subscribeActiveScroll(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function scrollActiveToTop() {
  activeEl?.scrollTo({ top: 0, behavior: 'smooth' });
}

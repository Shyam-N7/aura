// Contextual tap-hint bookkeeping. A hint shows at most MAX_SHOWS times ever,
// dies permanently the first time the user performs the hinted interaction
// (the HOST calls killHint inside its real handler), only one hint is live at
// a time, and all hints stay quiet while the site tour owns the screen.
// Storage: localStorage `aura.hint.<id>` = 'done' | '<show count>'.

const PREFIX = 'aura.hint.';
const MAX_SHOWS = 3;

export function hintDone(id) {
  try { return localStorage.getItem(PREFIX + id) === 'done'; } catch { return true; }
}

export function killHint(id) {
  try { localStorage.setItem(PREFIX + id, 'done'); } catch { /* ignore */ }
  releaseHint(id);
}

// Count a showing; false once the hint is done or has used its showings —
// a hint that never lands can't nag forever.
export function bumpHint(id) {
  try {
    const v = localStorage.getItem(PREFIX + id);
    if (v === 'done') return false;
    const n = (parseInt(v, 10) || 0) + 1;
    if (n > MAX_SHOWS) return false;
    localStorage.setItem(PREFIX + id, String(n));
    return true;
  } catch { return false; }
}

let live = null;
let suspended = false;
let waiters = [];

const notifyWaiters = () => {
  const ws = waiters;
  waiters = [];
  ws.forEach((cb) => cb());
};

export function claimHint(id) {
  if (suspended) return false;
  if (live && live !== id) return false;
  live = id;
  return true;
}

export function releaseHint(id) {
  if (live !== id) return;
  live = null;
  notifyWaiters();
}

// A refused claim isn't lost — the hint parks here and re-attempts when the
// slot frees (holder killed/retired/unmounted) or the tour lets go.
export function waitForHintSlot(cb) {
  waiters.push(cb);
  return () => { waiters = waiters.filter((w) => w !== cb); };
}

// App mirrors tourActive into this so a hint never renders under the tour scrim.
export function setHintsSuspended(on) {
  suspended = !!on;
  if (!suspended) notifyWaiters();
}

// Test hook — module singletons survive between specs otherwise.
export function _resetHintBus() { live = null; suspended = false; waiters = []; }

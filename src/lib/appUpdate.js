// Service-worker update controller. registerSW (main.jsx) feeds the apply fn + a
// "ready" signal here when a new build is waiting; consumers (App.jsx for the
// authed app, AppRoot for pre-auth pages) subscribe and APPLY the update at a SAFE
// moment — never mid-song. Kept out of React state so the SW registration (which
// runs once, near the root) and the playback-aware timing (deep in App.jsx) can
// share one source of truth.
let applyFn = null;   // updateSW(true) from registerSW → skip-waiting + reload
let ready = false;
const subs = new Set();

// Mark a new build as ready to install. `apply` is registerSW's updateSW fn.
export function markUpdateReady(apply) {
  applyFn = apply;
  ready = true;
  subs.forEach((fn) => { try { fn(true); } catch { /* ignore */ } });
}

export function isUpdateReady() { return ready; }

// Apply the waiting update now: skip-waiting + reload into the fresh build. A
// flag rides the reload (sessionStorage survives it) so the next load can show a
// brief "updated" confirmation.
export function applyUpdate() {
  if (!ready || !applyFn) return;
  try { sessionStorage.setItem('aura.justUpdated', '1'); } catch { /* ignore */ }
  applyFn(true);
}

// Subscribe to readiness. Fires immediately with the current value so a late
// subscriber (App mounts after the SW is already waiting) never misses the signal.
export function subscribeUpdate(cb) {
  subs.add(cb);
  try { cb(ready); } catch { /* ignore */ }
  return () => subs.delete(cb);
}

// Read + clear the one-shot "we just auto-updated" flag (for the post-reload toast).
export function consumeJustUpdated() {
  try {
    if (sessionStorage.getItem('aura.justUpdated')) {
      sessionStorage.removeItem('aura.justUpdated');
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

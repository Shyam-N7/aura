// Back-button exit guard. In-app navigation is replaceState-based (usePathRoute),
// so the browser/hardware Back button doesn't move between screens — it exits the
// app. One stray Back drops the user out. While the authed app is showing we trap
// Back, ask to confirm, and only let it through on "Leave".
//
// Registered at boot, BEFORE the routing popstate listeners (usePathRoute +
// AppRoot), so it can stopImmediatePropagation them and keep the current screen
// put while the confirm is open.

let armed = false;
let busy = false;
let confirmFn = null;

// The buffer entry is tagged in history.state so we can tell when we're already
// sitting on one — making pushGuard idempotent, so re-arming or re-absorbing
// never stacks duplicate entries.
function onGuardEntry() {
  return !!(window.history.state && window.history.state.auraExitGuard);
}
function pushGuard() {
  if (onGuardEntry()) return;
  try { history.pushState({ auraExitGuard: true }, '', window.location.href); }
  catch { /* history unavailable — nothing to guard */ }
}

function onPop(e) {
  if (!armed) return;               // pre-auth / not guarding → normal routing runs
  // Stop the app's other popstate listeners so the screen doesn't change while
  // we ask (this listener is registered first, so it wins).
  e.stopImmediatePropagation();
  if (busy) { pushGuard(); return; } // extra Back while the confirm is open → re-absorb it
  busy = true;
  Promise.resolve(confirmFn?.()).then((leave) => {
    busy = false;
    if (!armed) return;             // disarmed meanwhile (e.g. signed out)
    if (leave) {
      armed = false;
      // Best-effort exit: with real prior history this navigates/unloads. On a
      // single-entry launch (installed PWA cold-start / refresh) there's nothing
      // below, so back() is a no-op — we stay disarmed so the user's NEXT system
      // Back exits natively instead of being trapped (a page can't self-close).
      history.back();
    } else {
      pushGuard();                  // stay → re-arm the buffer entry
    }
  }).catch(() => { busy = false; });
}

// Call once, at boot, before React mounts.
export function initExitGuard() {
  window.addEventListener('popstate', onPop);
}

// Arm/disarm from the view machine. Arming pushes one buffer entry so the first
// Back is trapped instead of exiting; the `!armed` guard keeps re-renders from
// stacking extra entries.
export function setExitGuard(on, fn) {
  if (fn) confirmFn = fn;
  if (on && !armed) { armed = true; pushGuard(); }
  else if (!on && armed) { armed = false; }
}

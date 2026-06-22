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

function pushGuard() {
  try { history.pushState({ auraExitGuard: true }, '', window.location.href); }
  catch { /* history unavailable — nothing to guard */ }
}

function onPop(e) {
  if (!armed) return;               // pre-auth / not guarding → normal routing runs
  // Stop the app's other popstate listeners so the screen doesn't change while
  // we ask (this listener is registered first, so it wins).
  e.stopImmediatePropagation();
  if (busy) return;                 // a confirm is already open
  busy = true;
  Promise.resolve(confirmFn?.()).then((leave) => {
    busy = false;
    if (!armed) return;             // disarmed meanwhile (e.g. signed out)
    if (leave) {
      armed = false;
      history.back();               // let Back proceed → previous page / exit
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

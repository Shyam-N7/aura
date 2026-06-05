// Event bus that asks the search screen to focus its input. The `/` keyboard
// shortcut publishes; DesktopSearch subscribes. A pending flag is buffered so
// pressing `/` from a non-search route still focuses the input once App.jsx
// has navigated and DesktopSearch has mounted.

const subscribers = new Set();
let pending = false;

export function requestSearchFocus() {
  if (subscribers.size === 0) { pending = true; return; }
  for (const cb of subscribers) cb();
}

export function subscribeSearchFocus(cb) {
  subscribers.add(cb);
  if (pending) {
    pending = false;
    // Delay so the subscribing component has finished mounting before focus.
    // Re-check membership at fire time: if the component unmounted in the
    // same tick, skip the callback so we don't focus a torn-down ref.
    setTimeout(() => { if (subscribers.has(cb)) cb(); }, 0);
  }
  return () => { subscribers.delete(cb); };
}

// Cross-tab messaging on one device (BroadcastChannel). Used to keep tabs in sync
// — e.g. logging out in one tab logs the others out, and switching listening mode
// in one reflects in the rest. Guarded for environments without BroadcastChannel
// (older Safari, SSR, tests) — there it's a silent no-op.

let _ch;            // undefined = not yet created; null = unavailable
function chan() {
  if (_ch !== undefined) return _ch;
  try { _ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('aura') : null; }
  catch { _ch = null; }
  return _ch;
}

export function broadcast(type, payload) {
  try { chan()?.postMessage({ type, payload }); } catch { /* ignore */ }
}

// Subscribe to messages from OTHER tabs. Returns an unsubscribe fn.
export function onBroadcast(handler) {
  const c = chan();
  if (!c) return () => {};
  const fn = (e) => { try { handler(e.data?.type, e.data?.payload); } catch { /* ignore */ } };
  c.addEventListener('message', fn);
  return () => c.removeEventListener('message', fn);
}

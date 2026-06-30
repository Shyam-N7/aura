// Tiny haptic helper — a short vibration to confirm a press without looking (it
// earns its keep in Car Mode, where eyes are on the road). Feature-detected, so it
// is a clean no-op where `navigator.vibrate` is absent — notably iOS Safari, which
// exposes no web path to the Taptic Engine, making haptics Android/Chromium-only.
// Always call this from a real user-gesture handler (a press), never from an async
// result — several browsers ignore vibrate outside a user-activation window.
export function tap(ms = 10) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(ms); } catch { /* ignore */ }
}

// One-time site-tour flag. Per-device (localStorage) and deliberately NOT in
// auth.js's clearSession() list — like aura.theme it survives logout, so the
// tour never re-appears on later sign-ins from the same device.
const KEY = 'aura.tourDone';

export function hasSeenTour() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function markTourSeen() {
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
}

// Analytics consent (GDPR). Nothing analytics-related loads until the user
// explicitly allows it. Value is 'granted' | 'denied' | null (undecided).
const KEY = 'aura.analyticsConsent';
const subs = new Set();

export function getConsent() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setConsent(value) {
  try { localStorage.setItem(KEY, value); } catch { /* localStorage disabled — non-fatal */ }
  for (const cb of subs) cb(value);
}
export function subscribeConsent(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

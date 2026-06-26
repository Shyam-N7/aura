// Device-level cadence for the "sensing" welcome intro. The on/off choice is a
// per-user preference (users.show_sensing, via auth.showSensing()); this layer
// adds "show it at most once per calendar day" on top, so a user who keeps it on
// gets the moment on their first open of the day but isn't delayed on every cold
// load. Stored per-device in localStorage (not synced) — it's a presentation
// cadence, not user data.

const KEY = 'aura.sensingShown';

// Local calendar day (YYYY-MM-DD in the viewer's timezone), so "once per day"
// rolls over at the user's local midnight, not UTC.
function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function sensingShownToday() {
  try { return localStorage.getItem(KEY) === today(); }
  catch { return false; }
}

export function markSensingShown() {
  try { localStorage.setItem(KEY, today()); } catch { /* localStorage unavailable */ }
}

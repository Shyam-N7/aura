import { fetchAuthed } from '../lib/auth';

// Notification preferences (the settings switches). Absent row server-side =
// everything on, so a fresh account reads { mixes:true, social:true, nudges:true }.
export async function getPushPrefs() {
  const res = await fetchAuthed('/api/push/prefs');
  if (!res.ok) throw new Error(`prefs fetch failed (${res.status})`);
  return res.json();
}

export async function setPushPrefs(prefs) {
  const res = await fetchAuthed('/api/push/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'update failed');
  return data;
}

// Admin push console (allow-listed emails only — the server re-checks).
export async function adminPushReach() {
  const res = await fetchAuthed('/api/admin/push/reach');
  if (!res.ok) throw new Error(`reach fetch failed (${res.status})`);
  return res.json();
}

export async function adminPushSend({ title, body, link, image, audience }) {
  const res = await fetchAuthed('/api/admin/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, link, image, audience }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'send failed');
  return data;
}

// Admin schema console: current vs expected migration version, and the button
// that applies pending ones. Exists because migrations run out-of-band by
// design, and "out-of-band" used to mean a laptop with DATABASE_URL — when
// v34 shipped without that step, imports failed for everyone until a shell
// could be found.
export async function adminMigrateStatus() {
  const res = await fetchAuthed('/api/admin/migrate');
  if (!res.ok) throw new Error(`migrate status failed (${res.status})`);
  return res.json();
}

export async function adminMigrateApply() {
  const res = await fetchAuthed('/api/admin/migrate', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'migration failed');
  return data;
}

import { fetchAuthed } from '../lib/auth';

// In-app notification feed (the bell/panel) — the durable log of the same
// cards the push triggers send, always written regardless of push prefs.
export async function getNotifications() {
  const res = await fetchAuthed('/api/notifications');
  if (!res.ok) throw new Error(`notifications fetch failed (${res.status})`);
  return res.json();
}

export async function markNotificationsSeen() {
  const res = await fetchAuthed('/api/notifications/seen', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'mark seen failed');
  return data;
}

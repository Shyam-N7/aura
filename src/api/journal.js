import { fetchAuthed } from '../lib/auth';
export async function getJournal({ days = 7, signal } = {}) {
  const res = await fetchAuthed(`/api/journal?days=${days}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `journal fetch failed (${res.status})`);
  }
  return res.json();
}

import { fetchAuthed } from '../lib/auth';
export async function getCurrentMood({ refresh = false, signal } = {}) {
  const url = `/api/mood/current${refresh ? '?refresh=1' : ''}`;
  const res = await fetchAuthed(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `mood fetch failed (${res.status})`);
  }
  return res.json();
}

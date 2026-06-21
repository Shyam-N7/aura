import { fetchAuthed } from '../lib/auth';

// Curated, read-only Family-mode sets (devotional / wedding / kuthu), built fresh
// server-side and already explicit-filtered. Returns [{ key, title, tracks }].
export async function fetchFamilySets({ signal } = {}) {
  const res = await fetchAuthed('/api/family/sets', { signal });
  if (!res.ok) throw new Error(`family sets failed (${res.status})`);
  const data = await res.json();
  return data.sets ?? [];
}

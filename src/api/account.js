import { fetchAuthed } from '../lib/auth';

// GDPR self-service. Export returns the full data bundle; delete erases the
// account and cascades all listening history server-side.
export async function exportMyData({ signal } = {}) {
  const res = await fetchAuthed('/api/auth/me/export', { signal });
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  return res.json();
}

export async function deleteMyAccount() {
  const res = await fetchAuthed('/api/auth/me', { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete failed (${res.status})`);
  return res.json();
}

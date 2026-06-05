import { fetchAuthed } from '../lib/auth';
export async function getSonicDna({ signal } = {}) {
  const res = await fetchAuthed('/api/sonic-dna', { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `sonic-dna fetch failed (${res.status})`);
  }
  return res.json();
}

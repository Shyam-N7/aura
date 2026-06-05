import { fetchAuthed } from '../lib/auth';
export async function getBridge({ from, to, steps = 5, signal } = {}) {
  const res = await fetchAuthed(
    `/api/bridges/${encodeURIComponent(from)}/${encodeURIComponent(to)}?steps=${steps}`,
    { signal },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `bridge fetch failed (${res.status})`);
  }
  return res.json();
}

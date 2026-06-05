import { fetchAuthed } from '../lib/auth';
// Lyrics fetcher (client). Returns the same shape as the server:
//   { available, synced, lines? | plain?, source? }
export async function getLyrics(trackId, { signal } = {}) {
  const res = await fetchAuthed(`/api/lyrics/${encodeURIComponent(trackId)}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `lyrics fetch failed (${res.status})`);
  }
  return res.json();
}

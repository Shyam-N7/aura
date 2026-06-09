import { fetchAuthed } from '../lib/auth';
export async function getRelated(trackId, { lang, limit, signal } = {}) {
  const url = new URL(`/api/tracks/${encodeURIComponent(trackId)}/related`, window.location.origin);
  if (lang) url.searchParams.set('lang', lang);
  if (limit) url.searchParams.set('limit', String(limit));
  const res = await fetchAuthed(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `related failed (${res.status})`);
  }
  const data = await res.json();
  return data.tracks ?? [];
}

import { fetchAuthed } from '../lib/auth';
export async function getMostPlayed({ days = 30, limit = 10, signal } = {}) {
  const res = await fetchAuthed(`/api/stats/most-played?days=${days}&limit=${limit}`, { signal });
  if (!res.ok) throw new Error(`most-played failed (${res.status})`);
  const { tracks } = await res.json();
  return tracks ?? [];
}

export async function getTopArtists({ days = 30, limit = 8, signal } = {}) {
  const res = await fetchAuthed(`/api/stats/top-artists?days=${days}&limit=${limit}`, { signal });
  if (!res.ok) throw new Error(`top-artists failed (${res.status})`);
  const { artists } = await res.json();
  return artists ?? [];
}

export async function getRecentlyPlayed({ limit = 10, signal } = {}) {
  const res = await fetchAuthed(`/api/stats/recently-played?limit=${limit}`, { signal });
  if (!res.ok) throw new Error(`recently-played failed (${res.status})`);
  const { tracks } = await res.json();
  return tracks ?? [];
}

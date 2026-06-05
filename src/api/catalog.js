import { fetchAuthed } from '../lib/auth';
// Frontend client for /api/catalog/*. Each call accepts an AbortSignal so
// stale in-flight requests can be cancelled when the user keeps typing.

export async function searchCatalog(query, { lang, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (lang) params.set('lang', lang);
  const res = await fetchAuthed(`/api/catalog/search?${params}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `search failed (${res.status})`);
  }
  const { results, playlists } = await res.json();
  return { results: results ?? [], playlists: playlists ?? [] };
}

export async function getTrack(id, { signal } = {}) {
  const res = await fetchAuthed(`/api/catalog/track/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `track fetch failed (${res.status})`);
  }
  return res.json();
}

export async function getFeatured({ lang, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (lang) params.set('lang', lang);
  const res = await fetchAuthed(`/api/catalog/featured?${params}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `featured failed (${res.status})`);
  }
  const { results } = await res.json();
  return results;
}

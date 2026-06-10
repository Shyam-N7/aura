import { fetchAuthed } from '../lib/auth';
// Frontend client for /api/catalog/*. Each call accepts an AbortSignal so
// stale in-flight requests can be cancelled when the user keeps typing.

// Categorized search: best match (top) + songs / artists / albums(movies) /
// catalog playlists / the user's own playlists. `langs` (the user's languages,
// in priority order) drives "my-languages-first" ranking. Each list is empty
// when nothing matched so callers can hide the section. Artists arrive only
// when the top result isn't already an artist (server-gated).
export async function searchCatalog(query, { lang, langs, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (lang) params.set('lang', lang);
  if (langs?.length) params.set('langs', langs.join(','));
  const res = await fetchAuthed(`/api/catalog/search?${params}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `search failed (${res.status})`);
  }
  const d = await res.json();
  return {
    top:           d.top ?? null,
    songs:         d.songs ?? [],
    artists:       d.artists ?? [],
    albums:        d.albums ?? [],
    playlists:     d.playlists ?? [],
    userPlaylists: d.userPlaylists ?? [],
  };
}

// Full album / movie detail: { id, name, image, year, artist, subtitle, isMovie, tracks }.
export async function getAlbum(id, { signal } = {}) {
  const res = await fetchAuthed(`/api/albums/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `album failed (${res.status})`);
  }
  const data = await res.json();
  return data.album ?? null;
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

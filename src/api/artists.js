import { fetchAuthed } from '../lib/auth';
export async function getArtist({ name, id, trackId } = {}, { signal } = {}) {
  const url = new URL('/api/artists/lookup', window.location.origin);
  if (id)      url.searchParams.set('id', id);
  if (name)    url.searchParams.set('name', name);
  if (trackId) url.searchParams.set('trackId', trackId);
  const res = await fetchAuthed(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `artist failed (${res.status})`);
  }
  const data = await res.json();
  return data.artist ?? null;
}

export async function getAlbumTracks(albumId, { signal } = {}) {
  const url = new URL(`/api/albums/${encodeURIComponent(albumId)}/tracks`, window.location.origin);
  const res = await fetchAuthed(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `album tracks failed (${res.status})`);
  }
  const data = await res.json();
  return data.tracks ?? [];
}

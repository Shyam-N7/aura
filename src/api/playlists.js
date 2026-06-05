import { fetchAuthed } from '../lib/auth';
export async function listPlaylists({ signal } = {}) {
  const res = await fetchAuthed('/api/playlists', { signal });
  if (!res.ok) throw new Error(`playlists fetch failed (${res.status})`);
  const { playlists } = await res.json();
  return playlists ?? [];
}

export async function getPlaylist(id, { signal } = {}) {
  const res = await fetchAuthed(`/api/playlists/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `playlist fetch failed (${res.status})`);
  }
  return res.json();
}

export async function createPlaylist({ name, description = null } = {}) {
  const res = await fetchAuthed('/api/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `create failed (${res.status})`);
  }
  return res.json();
}

export async function deletePlaylist(id) {
  const res = await fetchAuthed(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete failed (${res.status})`);
}

export async function addToPlaylist(playlistId, trackId) {
  const res = await fetchAuthed(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track_id: trackId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `add failed (${res.status})`);
    err.status = res.status;
    if (res.status === 409) err.code = 'duplicate';
    throw err;
  }
}

export async function removeFromPlaylist(playlistId, trackId) {
  const res = await fetchAuthed(`/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`remove failed (${res.status})`);
}

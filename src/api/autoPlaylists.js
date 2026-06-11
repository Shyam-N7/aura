import { fetchAuthed } from '../lib/auth';

// Smart, read-only playlists generated from the user's listening (on repeat,
// bring it back). Each carries its full prebuilt track list, so a tap can play
// the sequence directly without a detail-screen round trip.
export async function listAutoPlaylists({ signal } = {}) {
  const res = await fetchAuthed('/api/playlists/auto', { signal });
  if (!res.ok) throw new Error(`auto playlists failed (${res.status})`);
  const { playlists } = await res.json();
  return playlists ?? [];
}

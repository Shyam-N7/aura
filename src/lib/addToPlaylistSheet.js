// Event bus for the "add to playlist" bottom sheet. Anywhere in the app can
// call openAddToPlaylist(trackOrTracks) — pass a single track or an array.
// The sheet mounted in App.jsx will surface and the picker will add them
// all to whichever playlist the user picks.

const subscribers = new Set();
let counter = 0;

export function openAddToPlaylist(trackOrTracks) {
  const tracks = (Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks])
    .filter(t => t?.id);
  if (!tracks.length) return;
  for (const cb of subscribers) cb({ id: ++counter, tracks });
}

export function subscribeAddToPlaylist(cb) {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

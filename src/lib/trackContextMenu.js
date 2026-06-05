// Bus for the global right-click track context menu. Desktop screens publish
// open events at the cursor position; TrackContextMenu (mounted in App.jsx)
// subscribes and renders.

const subscribers = new Set();

export function openTrackMenu(payload) {
  if (!payload?.track?.id) return;
  for (const cb of subscribers) cb(payload);
}

export function closeTrackMenu() {
  for (const cb of subscribers) cb(null);
}

export function subscribeTrackMenu(cb) {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

// Convenience for attaching to rows: `onContextMenu={ctxOpen(track)}`.
// preventDefault stops the OS menu; the bus fires immediately.
export function ctxOpen(track) {
  return (e) => {
    if (!track?.id) return;
    e.preventDefault();
    openTrackMenu({ track, x: e.clientX, y: e.clientY });
  };
}

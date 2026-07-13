// Bus for the global track context menu — right-click on desktop, long-press
// on phones. Screens publish open events at the pointer position;
// TrackContextMenu (mounted in App.jsx) subscribes and renders.

const subscribers = new Set();

// payload: { track, x, y, menu? }. `menu` tailors the items to the surface:
//   omit:   array of base-action ids to hide ('play'|'playNext'|'addToQueue'|
//           'addToPlaylist'|'like'|'artist') — e.g. omit 'addToQueue' in the
//           queue, or 'artist' on the artist page.
//   extras: surface-specific items [{ label, onClick, danger? }] shown below a
//           divider — e.g. "remove from this playlist", "don't show this again".
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

// Long-press + right-click, spread onto rows: `{...ctxPress(track)}`.
// Android fires a native `contextmenu` on long-press (the handler above covers
// it) but iOS Safari never does — so a 500ms touch-pointer timer opens the
// menu there. The suppress flag (self-clearing) stops Android's native event
// from double-opening right after the timer already fired. The data attribute
// hooks the global CSS that disables the iOS callout/text-selection on rows.
const LONG_PRESS_MS = 500;
const MOVE_SLOP_PX = 10;
let suppressNextCtx = false;

export function ctxPress(track) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return {
    'data-ctx-press': '',
    onContextMenu: (e) => {
      if (!track?.id) return;
      e.preventDefault();
      if (suppressNextCtx) { suppressNextCtx = false; return; }
      openTrackMenu({ track, x: e.clientX, y: e.clientY });
    },
    onPointerDown: (e) => {
      if (e.pointerType !== 'touch' || !track?.id) return;
      startX = e.clientX;
      startY = e.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        suppressNextCtx = true;
        setTimeout(() => { suppressNextCtx = false; }, 700);
        openTrackMenu({ track, x: startX, y: startY });
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      if (!timer) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

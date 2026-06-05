import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { subscribeTrackMenu, closeTrackMenu } from '../lib/trackContextMenu';
import { openAddToPlaylist } from '../lib/addToPlaylistSheet';
import { toast } from '../lib/toast';
// `aura-fadein` keyframe is defined in src/styles/animations.css.
import './TrackContextMenu.css';

const GAP = 4;

// Single global track-row right-click menu. Open via openTrackMenu({ track, x, y }).
// All actions route through the same App.jsx-level handlers regardless of which
// surface opened it — the menu just needs to know which track to operate on.
export function TrackContextMenu({ onPickLive, onPlayNext, onAddToQueue, onOpenArtist }) {
  const [event, setEvent] = useState(null);
  const [pos, setPos]     = useState({ left: 0, top: 0 });
  const ref = useRef(null);

  useEffect(() => subscribeTrackMenu(setEvent), []);

  // Clamp the menu inside the viewport after it renders so it doesn't spill
  // off-screen near edges. Also focus the first menuitem on open so keyboard
  // users can drive the menu without grabbing the mouse.
  useLayoutEffect(() => {
    if (!event || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const w = r.width  || 220;
    const h = r.height || 200;
    const left = Math.min(event.x, window.innerWidth  - w - GAP);
    const top  = Math.min(event.y, window.innerHeight - h - GAP);
    setPos({ left: Math.max(GAP, left), top: Math.max(GAP, top) });
    ref.current.querySelector('[role="menuitem"]')?.focus();
  }, [event]);

  // Close on Esc / outside-click / scroll / blur. Scroll close mirrors
  // every native OS context menu — keeps the popover from getting orphaned.
  useEffect(() => {
    if (!event) return;
    const items = () => Array.from(ref.current?.querySelectorAll('[role="menuitem"]') ?? []);
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        closeTrackMenu();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = items();
        if (!list.length) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement);
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = (i < 0 ? 0 : (i + dir + list.length) % list.length);
        list[next].focus();
      }
    };
    // Right-click on a different row must not close-then-reopen — `contextmenu`
    // fires AFTER mousedown, so the outside-click handler would close the menu
    // a frame before ctxOpen reopens it (visible flicker). Skip button 2.
    const onDown = (e) => {
      if (e.button === 2) return;
      if (!ref.current?.contains(e.target)) closeTrackMenu();
    };
    const onScroll = () => closeTrackMenu();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    // Capture-phase so it fires for nested scrollers too.
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', closeTrackMenu);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', closeTrackMenu);
    };
  }, [event]);

  if (!event) return null;
  const { track } = event;

  return (
    <div ref={ref} role="menu" aria-label="track actions"
      className="aura-ctx-menu" style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}>
      <button role="menuitem" className="aura-ctx-menu__item"
        onClick={() => { onPickLive?.(track); closeTrackMenu(); }}>
        <span className="aura-ctx-menu__item-icon">
          <svg width="13" height="13" viewBox="0 0 13 13"><path d="M3 2 L11 6.5 L3 11 Z" fill="currentColor"/></svg>
        </span>
        play song
      </button>
      <button role="menuitem" className="aura-ctx-menu__item"
        onClick={() => { onPlayNext?.(track); toast('queued next.'); closeTrackMenu(); }}>
        <span className="aura-ctx-menu__item-icon">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3 L8 6.5 L2 10 Z M10 3 V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="currentColor"/></svg>
        </span>
        play next
      </button>
      <button role="menuitem" className="aura-ctx-menu__item"
        onClick={() => { onAddToQueue?.(track); toast('added to queue.'); closeTrackMenu(); }}>
        <span className="aura-ctx-menu__item-icon">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3 H10 M2 6.5 H8 M2 10 H10 M11 5 V8 M9.5 6.5 H12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </span>
        add to queue
      </button>
      <button role="menuitem" className="aura-ctx-menu__item"
        onClick={() => { openAddToPlaylist(track); closeTrackMenu(); }}>
        <span className="aura-ctx-menu__item-icon">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3 H10 M2 6.5 H7 M2 10 H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="10" cy="9.5" r="2.6" stroke="currentColor" strokeWidth="1.3"/><path d="M10 8 V11 M8.5 9.5 H11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </span>
        add to playlist
      </button>
      {onOpenArtist && track.artist && (
        <>
          <div className="aura-ctx-menu__sep" role="separator"/>
          <button role="menuitem" className="aura-ctx-menu__item"
            onClick={() => { onOpenArtist({ name: track.artist, trackId: track.id }); closeTrackMenu(); }}>
            <span className="aura-ctx-menu__item-icon">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M2 11.5 Q6.5 7.5 11 11.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/></svg>
            </span>
            open artist
          </button>
        </>
      )}
    </div>
  );
}

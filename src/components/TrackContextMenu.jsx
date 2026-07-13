import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { subscribeTrackMenu, closeTrackMenu } from '../lib/trackContextMenu';
import { openAddToPlaylist } from '../lib/addToPlaylistSheet';
import { useLikes } from '../hooks/useLikes';
import { toast } from '../lib/toast';
// `aura-fadein` keyframe is defined in src/styles/animations.css.
import './TrackContextMenu.css';

const GAP = 4;

const ICONS = {
  play: <svg width="13" height="13" viewBox="0 0 13 13"><path d="M3 2 L11 6.5 L3 11 Z" fill="currentColor"/></svg>,
  playNext: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3 L8 6.5 L2 10 Z M10 3 V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="currentColor"/></svg>,
  addToQueue: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3 H10 M2 6.5 H8 M2 10 H10 M11 5 V8 M9.5 6.5 H12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  addToPlaylist: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3 H10 M2 6.5 H7 M2 10 H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="10" cy="9.5" r="2.6" stroke="currentColor" strokeWidth="1.3"/><path d="M10 8 V11 M8.5 9.5 H11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  like: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 11.2 C2 8.4 1 6 2.1 4.2 2.9 3 4.6 3 6.1 4.4 6.5 4.8 6.9 4.4 C8.4 3 10.1 3 10.9 4.2 12 6 11 8.4 6.5 11.2 Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  unlike: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 11.2 C2 8.4 1 6 2.1 4.2 2.9 3 4.6 3 6.1 4.4 M6.9 4.4 C8.4 3 10.1 3 10.9 4.2 12 6 11 8.4 6.5 11.2 Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M2.5 2 L10.5 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  artist: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M2 11.5 Q6.5 7.5 11 11.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/></svg>,
};

// Single global track menu. Open via openTrackMenu({ track, x, y, menu }). The
// base actions route through the App.jsx-level handlers; `menu.omit` drops ones
// that don't fit a surface and `menu.extras` adds surface-specific items, so one
// menu serves every screen with a context-appropriate set (no long-press twin).
export function TrackContextMenu({ onPickLive, onPlayNext, onAddToQueue, onOpenArtist }) {
  const [event, setEvent] = useState(null);
  const [pos, setPos]     = useState({ left: 0, top: 0 });
  const ref = useRef(null);
  // Subscribed so the like/unlike row flips live as like-state changes.
  const { isLiked, like, unlike } = useLikes();

  useEffect(() => subscribeTrackMenu(setEvent), []);

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
    const onDown = (e) => {
      if (e.button === 2) return;
      if (!ref.current?.contains(e.target)) closeTrackMenu();
    };
    const onScroll = () => closeTrackMenu();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
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
  const { track, menu = {} } = event;
  const omit = new Set(menu.omit ?? []);
  const run = (fn) => { fn?.(); closeTrackMenu(); };

  // Base actions in a fixed order; each surface omits the ones that don't fit.
  const base = [];
  if (!omit.has('play'))          base.push({ id: 'play', label: 'play song', onClick: () => onPickLive?.(track) });
  if (!omit.has('playNext'))      base.push({ id: 'playNext', label: 'play next', onClick: () => { onPlayNext?.(track); toast('queued next.'); } });
  if (!omit.has('addToQueue'))    base.push({ id: 'addToQueue', label: 'add to queue', onClick: () => { onAddToQueue?.(track); toast('added to queue.'); } });
  if (!omit.has('addToPlaylist')) base.push({ id: 'addToPlaylist', label: 'add to playlist', onClick: () => openAddToPlaylist(track) });
  if (!omit.has('like')) {
    base.push(isLiked(track.id)
      ? { id: 'unlike', label: 'unlike', onClick: () => { unlike(track.id); toast('removed from likes.'); } }
      : { id: 'like', label: 'like', onClick: () => { like(track.id); toast('added to likes.'); } });
  }
  if (!omit.has('artist') && onOpenArtist && track.artist) {
    base.push({ id: 'artist', label: 'open artist', onClick: () => onOpenArtist({ name: track.artist, trackId: track.id }) });
  }
  const extras = menu.extras ?? [];

  return (
    <div ref={ref} role="menu" aria-label="track actions"
      className="aura-ctx-menu" style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}>
      {base.map(a => (
        <button key={a.id} role="menuitem" className="aura-ctx-menu__item" onClick={() => run(a.onClick)}>
          <span className="aura-ctx-menu__item-icon">{ICONS[a.id]}</span>
          {a.label}
        </button>
      ))}
      {extras.length > 0 && <div className="aura-ctx-menu__sep" role="separator"/>}
      {extras.map((a, i) => (
        <button key={`x${i}`} role="menuitem"
          className={`aura-ctx-menu__item${a.danger ? ' aura-ctx-menu__item--danger' : ''}`}
          onClick={() => run(a.onClick)}>
          <span className="aura-ctx-menu__item-icon"/>
          {a.label}
        </button>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { AlbumArt } from '../album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import { VolumeSlider } from './VolumeSlider';
import { subscribe as subscribeSleep } from '../../lib/sleepTimer';
import './FloatingMini.css';

const STORAGE_KEY = 'aura.miniPos';
const DRAG_THRESHOLD = 5;  // pixels of pointer movement before drag overrides click

function readPos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return (typeof p?.x === 'number' && typeof p?.y === 'number') ? p : null;
  } catch { return null; }
}
function writePos(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// Compact transport visible when the desktop right rail is collapsed.
// Drag the body to reposition; click art/buttons for transport; click body
// without dragging to expand the rail back.
export function FloatingMini({ track, playing, player, onTogglePlay, onPrev, onNext, onOpenPlayer, onExpandRail }) {
  const [pos, setPos] = useState(readPos);
  const [dragging, setDragging] = useState(false);
  const [sleep, setSleep] = useState({ mode: null, remainingMs: null });
  const rootRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => subscribeSleep(setSleep), []);

  // Clamp on window resize so the orb never ends up off-screen.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const nx = Math.max(8, Math.min(window.innerWidth  - r.width  - 8, pos.x));
      const ny = Math.max(8, Math.min(window.innerHeight - r.height - 8, pos.y));
      if (nx !== pos.x || ny !== pos.y) { setPos({ x: nx, y: ny }); writePos({ x: nx, y: ny }); }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  if (!track) return null;

  const onPointerDown = (e) => {
    // Ignore drags that start on a button — let the click happen normally.
    if (e.target.closest('button')) return;
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      grabOffX: e.clientX - r.left, grabOffY: e.clientY - r.top,
      width: r.width, height: r.height,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    const nx = Math.max(8, Math.min(window.innerWidth  - d.width  - 8, e.clientX - d.grabOffX));
    const ny = Math.max(8, Math.min(window.innerHeight - d.height - 8, e.clientY - d.grabOffY));
    setPos({ x: nx, y: ny });
  };
  const endDrag = (e) => {
    const d = dragRef.current;
    setDragging(false);
    dragRef.current = null;
    if (!d) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d.moved) {
      const el = rootRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        writePos({ x: r.left, y: r.top });
      }
    } else {
      // Treat as click on the body — expand the rail.
      onExpandRail?.();
    }
  };

  const style = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : undefined;

  return (
    <div ref={rootRef}
      className={`aura-float-mini ${dragging ? 'aura-float-mini--dragging' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}>
      <button type="button" aria-label="open player"
        onClick={(e) => { e.stopPropagation(); onOpenPlayer?.(); }}
        className="aura-float-mini__art">
        <AlbumArt track={track} size={40} radius={9999}/>
      </button>
      <div key={track.id} className="aura-float-mini__meta aura-track-text">
        <div className="aura-float-mini__title">{cleanTitle(track.title)}</div>
        <div className="aura-float-mini__artist">
          {(track.artist ?? '').toLowerCase()}
          {sleep.mode === 'duration' && (
            <span className="aura-float-mini__sleep" aria-label="sleep timer active">
              · {Math.ceil(sleep.remainingMs / 60000)}m
            </span>
          )}
          {sleep.mode === 'end-of-set' && (
            <span className="aura-float-mini__sleep" aria-label="sleep at end of set">
              · end of set
            </span>
          )}
        </div>
      </div>
      <div className="aura-float-mini__ctrls">
        <button type="button" aria-label="previous"
          onClick={(e) => { e.stopPropagation(); onPrev?.(); }}
          className="aura-float-mini__btn">
          <svg width="12" height="9" viewBox="0 0 14 10"><path d="M14 0 L5 5 L14 10 Z M3 0 H1 V10 H3 Z" fill="currentColor"/></svg>
        </button>
        <button type="button" aria-label={playing ? 'pause' : 'play'}
          onClick={(e) => { e.stopPropagation(); onTogglePlay?.(); }}
          className="aura-float-mini__btn aura-float-mini__btn--play">
          {playing
            ? <svg width="10" height="12" viewBox="0 0 12 14"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
            : <svg width="10" height="12" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
        </button>
        <button type="button" aria-label="next"
          onClick={(e) => { e.stopPropagation(); onNext?.(); }}
          className="aura-float-mini__btn">
          <svg width="12" height="9" viewBox="0 0 14 10"><path d="M0 0 L9 5 L0 10 Z M11 0 H13 V10 H11 Z" fill="currentColor"/></svg>
        </button>
        {player && (
          <span onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}>
            <VolumeSlider player={player} compact/>
          </span>
        )}
      </div>
    </div>
  );
}

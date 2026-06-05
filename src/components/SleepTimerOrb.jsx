import { useEffect, useRef, useState } from 'react';
import { subscribe as subscribeSleep } from '../lib/sleepTimer';
import { openSleepTimer, subscribeSleepSheet } from '../lib/sleepTimerSheet';
import './SleepTimerOrb.css';

const STORAGE_KEY = 'aura.sleepOrbPos';
const DRAG_THRESHOLD = 5;   // pixels before pointer-down becomes a drag
const RAIL_WIDTH = 420;     // matches DesktopRail width
const ORB_SIZE = 52;

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

function readPos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return (typeof p?.right === 'number' && typeof p?.bottom === 'number') ? p : null;
  } catch { return null; }
}
function writePos(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// Persistent floating indicator shown while the sleep timer is armed.
//
// Position model: pos.right / pos.bottom are insets from the **safe area's**
// edge — i.e. the viewport minus the DesktopRail when it's open. The right
// inset is then offset by RAIL_WIDTH at render time when the rail is visible,
// which makes the orb slide left as the rail opens and back as it collapses
// (CSS `transition: right` does the easing).
//
// Drag: pointer-down arms a click-vs-drag heuristic. Moving past DRAG_THRESHOLD
// turns it into a drag; releasing without moving counts as a click → open the
// picker sheet. Position is persisted to localStorage.
export function SleepTimerOrb({ railCollapsed = true, isDesktop = false }) {
  const [state, setState] = useState({ mode: null, remainingMs: null });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pos, setPos] = useState(() => readPos() ?? { right: 16, bottom: isDesktop ? 88 : 100 });
  const [dragging, setDragging] = useState(false);
  const totalRef = useRef(0);
  const dragRef = useRef(null);

  useEffect(() => subscribeSleep((s) => {
    if (s.mode === 'duration' && s.remainingMs != null) {
      if (s.remainingMs > totalRef.current) totalRef.current = s.remainingMs;
    } else if (s.mode === null) {
      totalRef.current = 0;
    }
    setState(s);
  }), []);
  useEffect(() => subscribeSleepSheet(setSheetOpen), []);

  const railOffset = isDesktop && !railCollapsed ? RAIL_WIDTH : 0;

  // Clamp on viewport resize so the orb stays on-screen.
  useEffect(() => {
    const onResize = () => {
      setPos(p => {
        const maxRight  = Math.max(8,  window.innerWidth  - ORB_SIZE - railOffset - 8);
        const maxBottom = Math.max(16, window.innerHeight - ORB_SIZE - 16);
        const nr = Math.max(8,  Math.min(maxRight,  p.right));
        const nb = Math.max(16, Math.min(maxBottom, p.bottom));
        return (nr !== p.right || nb !== p.bottom) ? { right: nr, bottom: nb } : p;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [railOffset]);

  if (state.mode === null || sheetOpen) return null;

  const isDuration = state.mode === 'duration';
  const progress = isDuration && totalRef.current > 0
    ? Math.max(0, Math.min(1, state.remainingMs / totalRef.current))
    : 1;

  const radius = 23;
  const circ = 2 * Math.PI * radius;
  const dash = circ * progress;
  const label = isDuration ? fmt(state.remainingMs) : 'end of set';
  const urgent = isDuration && state.remainingMs <= 60_000;

  // Glow head dot rides the active arc.
  const angle = -Math.PI / 2 + 2 * Math.PI * progress;
  const headX = 26 + radius * Math.cos(angle);
  const headY = 26 + radius * Math.sin(angle);
  const showHead = isDuration && progress > 0.02 && progress < 0.98;

  // Render-time clamp guarantees the orb is never past the rail when it opens
  // — the stored pos is preserved so it springs back when the rail closes.
  // maxRight already excludes railOffset, so just min against pos.right.
  const maxRight = typeof window !== 'undefined'
    ? Math.max(8, window.innerWidth - ORB_SIZE - railOffset - 8) : 1000;
  const renderRight = railOffset + Math.min(maxRight, pos.right);
  const renderBottom = pos.bottom;

  const onPointerDown = (e) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRight: pos.right,
      startBottom: pos.bottom,
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
    // Pointer moves right → x increases → right inset shrinks.
    const maxR = Math.max(8, window.innerWidth  - ORB_SIZE - railOffset - 8);
    const maxB = Math.max(16, window.innerHeight - ORB_SIZE - 16);
    const newRight  = Math.max(8,  Math.min(maxR, d.startRight  - dx));
    const newBottom = Math.max(16, Math.min(maxB, d.startBottom - dy));
    setPos({ right: newRight, bottom: newBottom });
  };
  const endDrag = (e) => {
    const d = dragRef.current;
    setDragging(false);
    dragRef.current = null;
    if (!d) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d.moved) {
      writePos(pos);
    } else {
      // Pointer released without moving → treat as click.
      openSleepTimer();
    }
  };

  return (
    <button type="button"
      style={{ right: renderRight, bottom: renderBottom }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`aura-sleep-orb${urgent ? ' aura-sleep-orb--urgent' : ''}${dragging ? ' aura-sleep-orb--dragging' : ''}`}
      aria-label={isDuration ? `sleep in ${label}` : 'sleep at end of set'}>
      <svg className="aura-sleep-orb__ring" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r={radius} className="aura-sleep-orb__ring-track"/>
        <circle cx="26" cy="26" r={radius} className="aura-sleep-orb__ring-fill"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 26 26)"/>
        {showHead && (
          <circle cx={headX} cy={headY} r="2.4" className="aura-sleep-orb__ring-head"/>
        )}
      </svg>
      <span className="aura-sleep-orb__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20">
          <path d="M16 12.5 A6.5 6.5 0 1 1 7.5 4 A5.5 5.5 0 0 0 16 12.5 Z"
            fill="currentColor"/>
          <circle cx="14.6" cy="6"   r="0.75" className="aura-sleep-orb__star aura-sleep-orb__star--a"/>
          <circle cx="17"   cy="9"   r="0.55" className="aura-sleep-orb__star aura-sleep-orb__star--b"/>
          <circle cx="13"   cy="3.4" r="0.50" className="aura-sleep-orb__star aura-sleep-orb__star--c"/>
        </svg>
      </span>
      <span className="aura-sleep-orb__label">{label}</span>
      <span className="aura-sleep-orb__grip" aria-hidden="true">
        <svg width="8" height="14" viewBox="0 0 8 14">
          <circle cx="2" cy="3"  r="1"/>
          <circle cx="6" cy="3"  r="1"/>
          <circle cx="2" cy="7"  r="1"/>
          <circle cx="6" cy="7"  r="1"/>
          <circle cx="2" cy="11" r="1"/>
          <circle cx="6" cy="11" r="1"/>
        </svg>
      </span>
    </button>
  );
}

import { useState, useEffect, useRef, useMemo } from 'react';
import './ProgressRibbon.css';

export function ProgressRibbon({ progress = 0, accent, dim, playing, seed = 'x', width = 320, height = 60, onSeek }) {
  const phase = useRef(0);
  const [, force] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf;
    let last = 0;
    // Throttle wave-phase rerenders to ~30 Hz. Each force() rerenders this
    // component and recomputes 80 SVG path points — at native rAF (60-120 Hz)
    // that competes with scroll work and feels laggy.
    const tick = (now) => {
      if (now - last >= 33) {
        phase.current = (phase.current + 0.044) % (Math.PI * 2);
        force(n => (n + 1) % 1000);
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const shape = useMemo(() => {
    let s = 0; for (const c of seed) s = (s*31 + c.charCodeAt(0)) & 0xffffffff;
    return { a: ((s>>>0)%50)/220 + 0.16, f: 1.4 + ((s>>>4)%40)/40 };
  }, [seed]);

  const samples = 80;
  const waveY = (i) => {
    const tt = (i / samples) * Math.PI * 2 * shape.f + phase.current;
    const env = Math.sin((i/samples) * Math.PI) * 0.7 + 0.3;
    return height/2 + Math.sin(tt) * shape.a * height * env;
  };
  const path = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const x = (i / samples) * width;
      pts.push(`${i===0?'M':'L'} ${x.toFixed(1)} ${waveY(i).toFixed(1)}`);
    }
    return pts.join(' ');
    // phase.current is mutated by the RAF tick — intentional dep (re-computed each frame via force())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.current, width, height, shape]);
  // While the user is dragging the playhead, render at the cursor position
  // (optimistic) instead of the incoming `progress` prop. The audio seek only
  // fires on pointerup so we don't glitch playback with rapid mid-drag seeks.
  const [dragging, setDragging] = useState(false);
  const dragProgress = useRef(0);
  // Defensive: if the component unmounts mid-drag (e.g., user closes the
  // player screen while scrubbing), make sure `dragging` doesn't survive
  // into the next mount and leave the playhead frozen at dragProgress.
  useEffect(() => () => setDragging(false), []);
  const effectiveProgress = dragging ? dragProgress.current : progress;
  const playheadX = width * effectiveProgress;
  const playheadI = effectiveProgress * samples;
  const playheadY = waveY(playheadI);

  const progressFromEvent = (e, el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const onPointerDown = (e) => {
    if (!onSeek) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragProgress.current = progressFromEvent(e, e.currentTarget);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    dragProgress.current = progressFromEvent(e, e.currentTarget);
    force(n => (n + 1) % 1000);
  };
  const onPointerUp = (e) => {
    if (!dragging) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const final = dragProgress.current;
    setDragging(false);
    onSeek(final);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`aura-progress-ribbon ${onSeek ? 'aura-progress-ribbon--seekable' : ''}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        className="aura-progress-ribbon__svg"
        style={{ '--ribbon-height': `${height}px` }}>
        <defs>
          <clipPath id={`clip-${seed}`}>
            <rect x="0" y="0" width={width * effectiveProgress} height={height}/>
          </clipPath>
          {/* Gradient is anchored to the full bar width (not the clipped portion),
              so at any progress < 100% the user sees the LEFT chunk of the
              gradient. Floor must be high enough to read against the dim line
              behind it — at 0.5 it was invisible until ~90% progress. */}
          <linearGradient id={`grad-${seed}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor={accent} stopOpacity="0.85"/>
            <stop offset="100%" stopColor={accent} stopOpacity="1"/>
          </linearGradient>
        </defs>
        <path d={path} stroke={dim} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
        <path d={path} stroke={`url(#grad-${seed})`} strokeWidth="2.2" fill="none" strokeLinecap="round" clipPath={`url(#clip-${seed})`}/>
        <circle cx={playheadX} cy={playheadY} r="9" fill={accent} opacity="0.18"/>
        <circle cx={playheadX} cy={playheadY} r="4" fill={accent}/>
      </svg>
    </div>
  );
}

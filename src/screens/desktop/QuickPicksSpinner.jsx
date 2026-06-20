import { useCallback, useEffect, useRef } from 'react';
import { AlbumArt } from '../../components/album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import './QuickPicksSpinner.css';

// Quick picks as a spinnable wheel — phone-only (desktop keeps QuickPicksOrbit).
// Album discs sit around a circle; grab + flick rotates the wheel like a fidget
// spinner: the drag tracks angular velocity, release coasts with friction decay.
// The wheel rotates via a single `--spin` CSS var (one write per frame); each
// disc counter-rotates by -spin so the art + label stay upright while orbiting.
// A flick spins; a tap plays the disc (morphing the cover up into the player).
const FRICTION = 0.95;   // velocity retained per frame while coasting
const MIN_VEL  = 0.12;   // deg/frame below which the coast stops
const MAX_VEL  = 46;     // deg/frame cap so a hard flick can't go wild
const TAP_SLOP = 7;      // total deg of travel under which the gesture is a tap

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function QuickPicksSpinner({ tracks, currentTrackId, onPlay }) {
  const ringRef  = useRef(null);
  const wheelRef = useRef(null);
  const spin   = useRef(0);              // current wheel angle (deg)
  const vel    = useRef(0);              // angular velocity (deg/ms) while dragging
  const raf    = useRef(0);
  const ctrl   = useRef(null);           // AbortController for the active drag's window listeners
  const center = useRef({ x: 0, y: 0 });
  const last   = useRef({ a: 0, t: 0 });
  const start  = useRef({ x: 0, y: 0 }); // pointer-down point, for intent detection
  const intent = useRef('none');         // 'none' | 'spin' | 'scroll' — locked on first move
  const moved  = useRef(0);
  const dragging = useRef(false);
  const dragged  = useRef(false);        // true once a drag passed TAP_SLOP — suppresses the disc's click

  const apply = (deg) => wheelRef.current?.style.setProperty('--spin', `${deg}deg`);
  const angleOf = (e) =>
    Math.atan2(e.clientY - center.current.y, e.clientX - center.current.x) * 180 / Math.PI;

  const onMove = useCallback((e) => {
    if (!dragging.current || intent.current === 'scroll') return;
    const a = angleOf(e);
    let d = a - last.current.a;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    const dt = Math.max(1, e.timeStamp - last.current.t);
    spin.current += d;
    moved.current += Math.abs(d);
    vel.current = 0.7 * vel.current + 0.3 * (d / dt);
    last.current = { a, t: e.timeStamp };
    if (moved.current > TAP_SLOP) dragged.current = true;
    apply(spin.current);
  }, []);

  const onUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    ctrl.current?.abort();                              // drop this drag's window listeners
    if (!dragged.current || reducedMotion()) return;   // a tap (or no-motion pref) → let the disc click play it
    let v = Math.max(-MAX_VEL, Math.min(MAX_VEL, vel.current * 16));
    const coast = () => {
      spin.current += v;
      v *= FRICTION;
      apply(spin.current);
      if (Math.abs(v) > MIN_VEL) raf.current = requestAnimationFrame(coast);
    };
    if (Math.abs(v) > MIN_VEL) raf.current = requestAnimationFrame(coast);
  }, []);

  const onDown = (e) => {
    cancelAnimationFrame(raf.current);
    const r = ringRef.current.getBoundingClientRect();
    center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    dragging.current = true;
    dragged.current = false;
    moved.current = 0;
    vel.current = 0;
    start.current = { x: e.clientX, y: e.clientY };
    intent.current = 'none';
    last.current = { a: angleOf(e), t: e.timeStamp };
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    const { signal } = ctrl.current;
    window.addEventListener('pointermove', onMove, { signal });
    window.addEventListener('pointerup', onUp, { signal });
    window.addEventListener('pointercancel', onUp, { signal });
  };

  // Intent gate (touch): on the first ~8px, lock the gesture to either the wheel
  // (horizontal/rotational flick → spin, hold it so page scroll can't steal it)
  // or the page (vertical drag → release for a perfect native scroll). Native +
  // non-passive so we can preventDefault once we've claimed a spin.
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return undefined;
    const onTouchMove = (e) => {
      if (!dragging.current) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (intent.current === 'none' && Math.hypot(dx, dy) > 8) {
        intent.current = Math.abs(dx) > Math.abs(dy) ? 'spin' : 'scroll';
        if (intent.current === 'scroll') { dragging.current = false; ctrl.current?.abort(); }
        else last.current = { a: Math.atan2(t.clientY - center.current.y, t.clientX - center.current.x) * 180 / Math.PI, t: e.timeStamp };
      }
      if (intent.current === 'spin') e.preventDefault();   // we own this gesture — page won't scroll
    };
    ring.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => ring.removeEventListener('touchmove', onTouchMove);
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    ctrl.current?.abort();
  }, []);

  const n = tracks.length;
  if (!n) return null;

  return (
    <div className="aura-qps">
      <div ref={ringRef} className="aura-qps__ring" onPointerDown={onDown}>
        <div ref={wheelRef} className="aura-qps__wheel">
          {tracks.map((t, i) => {
            const a = (-90 + (360 / n) * i) * (Math.PI / 180);
            const x = 50 + 38 * Math.cos(a);
            const y = 50 + 38 * Math.sin(a);
            const playing = t.id === currentTrackId;
            return (
              <button key={t.id} type="button"
                className={`aura-qps__card${playing ? ' aura-qps__card--playing' : ''}`}
                style={{ left: `${x}%`, top: `${y}%`, '--i': i }}
                onClick={(e) => {
                  if (dragged.current) { dragged.current = false; return; }
                  onPlay?.(t, e.currentTarget.querySelector('.aura-qps__art'));
                }}
                aria-label={`play ${cleanTitle(t.title)}${t.artist ? ` by ${t.artist}` : ''}`}>
                <span className="aura-qps__art">
                  <AlbumArt track={t} radius={999} style={{ width: '100%', height: '100%' }}/>
                  {playing && <span className="aura-qps__aura" aria-hidden="true"><i/><i/><i/></span>}
                </span>
                <span className="aura-qps__name">{cleanTitle(t.title)}</span>
              </button>
            );
          })}
        </div>

        <div className="aura-qps__hub" aria-hidden="true">
          <span className="aura-qps__hub-ring aura-qps__hub-ring--a"/>
          <span className="aura-qps__hub-ring aura-qps__hub-ring--b"/>
          <span className="aura-qps__hub-dot"/>
          <span className="aura-qps__hub-hint">flick to spin</span>
        </div>
      </div>
    </div>
  );
}

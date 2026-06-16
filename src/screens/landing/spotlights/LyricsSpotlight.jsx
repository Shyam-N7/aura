import { useEffect, useRef, useState } from 'react';
import { LYRIC_DEMO } from '../showcaseData';
import { useAnalyserFrame } from '../useAnalyserFrame';
import '@fontsource/dancing-script/700.css';
import '@fontsource/fraunces/400.css';
import '../../overlays/LyricsScreen.css'; // real cinematic classes

const PlayIcon = () => (
  <svg width="13" height="15" viewBox="0 0 13 15" aria-hidden="true"><path d="M0 0 L13 7.5 L0 15 Z" fill="currentColor"/></svg>
);
const PauseIcon = () => (
  <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><rect x="0" y="0" width="4" height="14" fill="currentColor"/><rect x="8" y="0" width="4" height="14" fill="currentColor"/></svg>
);

// Spotlight: the cinematic idle lyrics look, built from the REAL classes
// (.aura-lyrics-epigraph in Dancing Script, .aura-lyrics-line--cinema-* in
// Fraunces, the art tint + scrim + progress arc). The real LyricsScreen panel
// is position:fixed full-screen, so we render the inner *stage* inside a framed
// box and drive audioTime with a play/scrub control. A 4-line window keeps the
// active line centered like the live screen's auto-scroll.
export function LyricsSpotlight({ analyser, isPlaying }) {
  const { title, artist, cover: [c1, c2], durationSec, lines } = LYRIC_DEMO;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const last = useRef(0);
  const vizRef = useRef(null);

  // When the hero pad is playing, the 24 bars track REAL frequency data (per-bar
  // height via --bar) instead of the canned CSS ripple. Idle → keep the ripple
  // during the spotlight's own local play; otherwise they rest near-flat.
  const audioActive = !!(analyser && isPlaying);
  useAnalyserFrame(vizRef, analyser, isPlaying, {
    onFrame: (buf, level) => {
      const bars = vizRef.current?.children;
      if (!bars) return;
      const n = bars.length;
      for (let i = 0; i < n; i++) {
        // Low-skewed (quadratic) bin sampling so the bars sit where the pad
        // actually has energy, blended with the overall level so every bar
        // breathes with the envelope instead of just the first one or two.
        const frac = i / n;
        const bin = Math.floor(frac * frac * 48);
        const v = 0.16 + Math.min(1, (buf[bin] / 255) * 0.7 + level * 0.55) * 0.84;
        bars[i].style.setProperty('--bar', v.toFixed(3));
      }
    },
    onStop: () => {
      const bars = vizRef.current?.children;
      if (bars) for (const b of bars) b.style.removeProperty('--bar');
    },
  });

  useEffect(() => {
    if (!playing) return undefined;
    last.current = performance.now();
    const tick = (now) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= durationSec) { setPlaying(false); return durationSec; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, durationSec]);

  let activeIdx = -1;
  lines.forEach((l, i) => { if (l.t <= t) activeIdx = i; });
  const pct = Math.min(100, (t / durationSec) * 100);
  const ended = t >= durationSec;

  // Centered window: one line above the active, two below.
  const start = Math.max(0, (activeIdx < 0 ? 0 : activeIdx) - 1);
  const window = lines.slice(start, start + 4);

  return (
    <div className="lp-lyrics">
      <div className="lp-lyrics-stage aura-lyrics-panel--cinematic">
        <div className="aura-lyrics-art-tint" aria-hidden="true"
          style={{ backgroundImage: `linear-gradient(135deg, ${c1}, ${c2})` }}/>
        <div className="aura-lyrics-art-scrim" aria-hidden="true"/>

        <div className="aura-lyrics-progress-arc" aria-hidden="true">
          <div className="aura-lyrics-progress-arc__fill" style={{ width: `${pct}%` }}/>
          <span className="aura-lyrics-progress-arc__dot aura-lyrics-progress-arc__dot--start"/>
          <span className={`aura-lyrics-progress-arc__dot aura-lyrics-progress-arc__dot--end${ended ? ' is-ended' : ''}`}/>
        </div>

        <div className="aura-lyrics-epigraph" aria-hidden="true">
          {title}
          <div className="aura-lyrics-epigraph__counter">{ended ? 'Song ended' : artist}</div>
        </div>

        <div className="lp-lyrics__lines">
          {window.map(({ line }, w) => {
            const i = start + w;
            const cls = i === activeIdx ? 'aura-lyrics-line--cinema-active'
              : i < activeIdx ? 'aura-lyrics-line--cinema-past'
              : 'aura-lyrics-line--cinema-upcoming';
            const size = i === activeIdx ? 'text-[24px]' : 'text-[18px]';
            return <div key={i} className={`aura-lyrics-line ${cls} ${size} leading-[1.25]`}>{line}</div>;
          })}
        </div>
      </div>

      <div
        ref={vizRef}
        className={`lp-lyrics__viz${audioActive ? ' is-audio' : playing ? ' is-playing' : ''}`}
        aria-hidden="true"
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <span key={i} className="lp-lyrics__viz-bar" style={{ '--i': i }} />
        ))}
      </div>

      <div className="lp-lyrics__controls">
        <button type="button" className="lp-lyrics__play"
          onClick={() => { if (ended) setT(0); setPlaying((p) => !p); }}
          aria-label={playing ? 'pause' : 'play'}>
          {playing ? <PauseIcon/> : <PlayIcon/>}
        </button>
        <input type="range" min="0" max={durationSec} step="0.1" value={t}
          onChange={(e) => setT(parseFloat(e.target.value))}
          className="lp-lyrics__scrub" aria-label="scrub lyrics"/>
      </div>
    </div>
  );
}

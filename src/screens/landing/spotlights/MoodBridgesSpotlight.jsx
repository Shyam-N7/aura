import { useRef, useState } from 'react';
import { BridgeItinerary } from '../../desktop/BridgeItinerary';
import { BRIDGE_PRESETS } from '../showcaseData';
import { useGsap, chipPop } from '../useGsap';
import '../../desktop/DesktopBridges.css'; // .aura-dbr-itin* styles

// Draws the bezier arc on (once) when the band scrolls in, then fades the
// album-art rungs in behind it. Scoped to this wrapper's ref, so BridgeItinerary
// itself is never modified. clearProps after the draw so later chip-swaps (which
// reuse the same <path> with a new `d`) render fully, not clipped by a stale dash.
function bridgeDraw({ gsap, q, root }) {
  const at = { trigger: root, start: 'top 78%', once: true };
  const path = q('.aura-dbr-itin__svg path')[0];
  if (path && typeof path.getTotalLength === 'function') {
    const len = path.getTotalLength();
    gsap.fromTo(path,
      { strokeDasharray: len, strokeDashoffset: len },
      { strokeDashoffset: 0, duration: 1.0, ease: 'power2.out',
        onComplete: () => gsap.set(path, { clearProps: 'strokeDasharray,strokeDashoffset' }),
        scrollTrigger: { ...at } });
  }
  const rungs = q('.aura-dbr-itin__svg g');
  if (rungs.length) {
    // Album-art rungs pop up the arc with a springy overshoot.
    gsap.from(rungs, {
      opacity: 0, y: 12, duration: 0.5, stagger: 0.09, ease: 'back.out(2)', delay: 0.4,
      clearProps: 'transform', scrollTrigger: { ...at },
    });
  }
}

// Spotlight: the REAL BridgeItinerary, fed curated journeys. Tapping a mood
// chip swaps the whole bridge — the bezier arc, album-art rungs, gradient and
// narrative all redraw, exactly as the live bridges screen does.
export function MoodBridgesSpotlight() {
  const [i, setI] = useState(0);
  const ref = useRef(null);
  useGsap(ref, bridgeDraw);
  const b = BRIDGE_PRESETS[i];
  return (
    <div className="lp-bridges" ref={ref}>
      <div className="lp-bridges__chips">
        {BRIDGE_PRESETS.map((p, idx) => (
          <button key={p.id} type="button"
            className={`lp-chip${idx === i ? ' is-on' : ''}`}
            aria-pressed={idx === i}
            onClick={(e) => { chipPop(e.currentTarget); setI(idx); }}>
            {p.from} → {p.to}
          </button>
        ))}
      </div>
      <div className="lp-bridges__card">
        <BridgeItinerary
          bridge={{ id: b.id, from: b.from, to: b.to, steps: b.steps }}
          tracks={b.tracks}
          narrative={b.narrative}
        />
      </div>
    </div>
  );
}

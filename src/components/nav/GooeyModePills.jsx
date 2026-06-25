import { useLayoutEffect, useRef, useState } from 'react';
import './GooeyModePills.css';

// Gooey liquid mode PILLS. Two layers: crisp pill buttons (geometry + labels) on
// top, and a single accent "fill" behind them under the #aura-goo-radio metaball
// filter. On switch the fill flows from the old pill's box to the new and settles
// in — a liquid drop that empties the old pill and fills the target. Labels stay
// crisp (outside the goo). Solid fill so the metaball threshold preserves it.
export function GooeyModePills({ modes = [], activeMode = 'everyday', onSelect, loading = false }) {
  const idx = Math.max(0, modes.findIndex(m => m.key === activeMode));
  const pillRefs = useRef([]);
  const [fill, setFill] = useState(null);   // { x, y, w, h } of the active pill, in wrapper coords

  // Measure the active pill's box so the fill can sit on it + transition to it on
  // change. offsetLeft/Top are relative to the position:relative wrapper, the same
  // origin the absolute fill translates from. Re-measure on resize / mode change.
  useLayoutEffect(() => {
    function measure() {
      const pill = pillRefs.current[idx];
      if (!pill) return;
      setFill({ x: pill.offsetLeft, y: pill.offsetTop, w: pill.offsetWidth, h: pill.offsetHeight });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [idx, modes.length]);

  return (
    <div className="aura-goopills" role="radiogroup" aria-label="Listening mode">
      {/* Goo layer — the single accent fill, behind the pills, under the metaball. */}
      <div className="aura-goopills__goo" aria-hidden="true">
        {fill && (
          <span className="aura-goopills__fill" style={{
            transform: `translate(${fill.x}px, ${fill.y}px)`,
            width: `${fill.w}px`,
            height: `${fill.h}px`,
          }}/>
        )}
      </div>
      {/* Pill layer — crisp buttons + labels. */}
      {modes.map((m, i) => (
        <button key={m.key} type="button" role="radio" aria-checked={i === idx}
          ref={(el) => { pillRefs.current[i] = el; }}
          className={`aura-goopills__pill${i === idx ? ' is-active' : ''}${loading && i === idx ? ' is-loading' : ''}`}
          onClick={() => onSelect?.(m.key)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

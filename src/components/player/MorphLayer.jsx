import { useState, useEffect } from 'react';
import { AlbumArt } from '../album/AlbumArt';
import './MorphLayer.css';

// Shared-element morph: starts at fromRect and animates to toRect over durationMs.
// Rendered above all screens so source/target are covered cleanly during transition.
// Rect coords + transition duration flow in as CSS vars; styling lives in MorphLayer.css.
export function MorphLayer({ track, fromRect, toRect, kind, durationMs = 460 }) {
  // `blur` rides the same one-shot transition: an opening cover starts soft and
  // resolves to sharp as it seats into the destination frame (a "develops into
  // focus" landing); closes stay sharp.
  const [rect, setRect] = useState({ ...fromRect, radius: fromRect.radius ?? 12, blur: kind === 'open' ? 8 : 0 });
  useEffect(() => {
    // Two RAFs to ensure the initial style commits before the transition starts.
    const id = requestAnimationFrame(() => requestAnimationFrame(() =>
      setRect({ ...toRect, radius: toRect.radius ?? 12, blur: 0 })));
    return () => cancelAnimationFrame(id);
    // One-shot kicker on mount — toRect is captured from props at mount and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const max = Math.max(rect.width, rect.height, fromRect.width, fromRect.height, toRect.width, toRect.height);
  const shadowClass = kind === 'open'
    ? 'shadow-[0_30px_70px_rgb(0_0_0/0.35),0_6px_18px_rgb(0_0_0/0.20)]'
    : 'shadow-[0_14px_32px_color-mix(in_srgb,var(--color-accent),transparent_67%),0_2px_6px_rgb(0_0_0/0.18)]';
  return (
    <div
      className={`aura-morph-layer ${shadowClass}`}
      style={{
        '--morph-left':     `${rect.left}px`,
        '--morph-top':      `${rect.top}px`,
        '--morph-width':    `${rect.width}px`,
        '--morph-height':   `${rect.height}px`,
        '--morph-radius':   `${rect.radius}px`,
        '--morph-blur':     `${rect.blur}px`,
        '--morph-duration': `${durationMs}ms`,
      }}
    >
      <AlbumArt track={track} size={max} radius={0}
        className="aura-album-art--fill"
        style={{ '--album-shadow': 'none' }}/>
    </div>
  );
}

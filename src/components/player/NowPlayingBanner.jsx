import { useEffect, useRef, useState } from 'react';
import { MonoLabel } from '../primitives';
import { MorphingAlbumArt } from '../album/MorphingAlbumArt';
import { cleanTitle } from '../../utils/title';
import './NowPlayingBanner.css';

// Measures its text against the available width and, only when it overflows,
// scrolls it ping-pong so a long title stays fully readable. Transform-only
// (GPU) and gated on `is-scrolling` so short titles never animate. Reduced
// motion + the compact `car` variant fall back to no scroll (see the CSS).
function Marquee({ text, className }) {
  const wrap = useRef(null);
  const inner = useRef(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const measure = () => {
      const w = wrap.current;
      const i = inner.current;
      if (!w || !i) return;
      setOverflow(Math.max(0, i.scrollWidth - w.clientWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    // Observe BOTH: the wrap (container resizes) and the inner span (its own
    // width changes when the serif web-font swaps in after first paint).
    if (wrap.current) ro.observe(wrap.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div ref={wrap} className={`aura-npb__marquee ${overflow ? 'is-scrolling' : ''}`}
      style={{ '--npb-shift': `${overflow}px` }}>
      <span ref={inner} className={className}>{text}</span>
    </div>
  );
}

// Per-variant cover size (px) — the base the art renders at. Everything else
// (title scale, marquee, spacing) is driven by the `aura-npb--{variant}`
// modifier class in the CSS; the car variant additionally sizes the art BOX in
// CSS (with the art filling it) so the short-phone media query can shrink the
// cover — a JS-only size would be unreachable from CSS.
const COVER = { car: 48, quick: 72, 'talk-desktop': 64, 'talk-mobile': 52 };

// A distinctive now-playing card shared across non-player surfaces (Car Mode,
// Quick Access, Talk). On every track change the cover cross-fades (MorphingAlbumArt)
// and the title/artist flourish in; long titles ticker. Renders nothing when
// nothing is playing, so call sites can mount it unconditionally.
export function NowPlayingBanner({ track, variant = 'quick', onOpen, label, className = '', style }) {
  if (!track) return null;
  const title = cleanTitle(track.title);
  const size = COVER[variant] ?? 64;
  const Root = onOpen ? 'button' : 'div';
  return (
    <Root
      type={onOpen ? 'button' : undefined}
      onClick={onOpen}
      aria-label={onOpen ? `open player — ${title} by ${track.artist}` : undefined}
      className={`aura-npb aura-npb--${variant} ${onOpen ? 'aura-npb--tappable' : ''} ${className}`}
      style={style}>
      <div className="aura-npb__art" aria-hidden="true">
        <MorphingAlbumArt track={track} size={size} radius={14}/>
      </div>
      <div className="aura-npb__meta">
        {label && <MonoLabel className="aura-npb__kicker" size={9}>{label}</MonoLabel>}
        {/* key={track.id} remounts the block so the flourish replays on each change */}
        <div key={track.id} className="aura-npb__flourish">
          <div className="aura-npb__title-vp">
            <Marquee text={title} className="aura-npb__title"/>
          </div>
          <div className="aura-npb__artist">{track.artist}</div>
        </div>
      </div>
    </Root>
  );
}

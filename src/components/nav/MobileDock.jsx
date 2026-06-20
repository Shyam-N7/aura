import { useEffect, useRef, useState } from 'react';
import { ICON } from '../primitives';
import { AlbumArt } from '../album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import './MobileDock.css';

// Unified mobile bottom dock — ONE glass pill that carries both the now-playing
// strip and the nav row, replacing the earlier two-stacked-pills attempt (which
// read as two heavy "islands"). Layout, top to bottom:
//
//   [ cover · title/artist ······· play/pause ]   ← now-playing lip (track only)
//   ──────────────●───────────────────────────    ← hairline progress at the seam
//   [  home    search    talk    you  ]            ← nav row (always)
//
// Tapping the now-playing lip morphs the cover up into the full player (App
// routes the tapped art element through morphInto); the play disc stops
// propagation. While the active screen is scrolled (`mode==='backtotop'`) the
// whole dock liquid-morphs into a centered "Take me back up" pill — the lip
// collapses, the nav items melt out and the label fuses in (goo rides the inner
// content for the morph window only).

// Speech-bubble glyph with three conversation dots — matches the NavRail's
// "ask aura" icon so the talk affordance reads the same across mobile + desktop.
function TalkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.2 3.5 a1.5 1.5 0 0 1 1.5 -1.5 h8.6 a1.5 1.5 0 0 1 1.5 1.5 v6 a1.5 1.5 0 0 1 -1.5 1.5 h-5.4 l-3.2 2.6 v-2.6 h-0 a1.5 1.5 0 0 1 -1.5 -1.5 z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <circle cx="5.5"  cy="6.7" r="0.95" fill="currentColor"/>
      <circle cx="8"    cy="6.7" r="0.95" fill="currentColor"/>
      <circle cx="10.5" cy="6.7" r="0.95" fill="currentColor"/>
    </svg>
  );
}

const NAV_ITEMS = [
  { id: 'home',    label: 'home',   icon: ICON.home   },
  { id: 'search',  label: 'search', icon: ICON.search },
  { id: 'talk',    label: 'talk',   icon: <TalkIcon/>, talk: true },
  { id: 'library', label: 'you',    icon: ICON.you    },
];
const HOME_STACK = new Set(['journal', 'dna', 'bridges', 'player', 'queue']);

export function MobileDock({
  track, playing, progress = 0,
  onTogglePlay, onOpenPlayer,
  active, onNav, onTalk,
  mode = 'bar', onBackToTop,
}) {
  const btt = mode === 'backtotop';
  const artRef = useRef(null);

  // Apply the goo filter only for the back-to-top morph's duration — at rest it
  // would just blur the content. Skip the first render so it doesn't morph on mount.
  const [morphing, setMorphing] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setMorphing(true);
    const id = setTimeout(() => setMorphing(false), 460);
    return () => clearTimeout(id);
  }, [mode]);

  return (
    <div className={`aura-dock${track ? ' aura-dock--np' : ''}${btt ? ' aura-dock--btt' : ''}${morphing ? ' aura-dock--morphing' : ''}`}>
      <div className="aura-dock__inner">
        {/* Now-playing lip — collapses (grid 0fr) during the back-to-top morph. */}
        <div className="aura-dock__lip-wrap">
          <div className="aura-dock__lip-inner">
            {track && (
              <div className="aura-dock__np">
                <button type="button" className="aura-dock__np-open" data-tour="mnav-np"
                  tabIndex={btt ? -1 : 0} onClick={() => onOpenPlayer?.(artRef.current)}>
                  <span ref={artRef} className="aura-dock__np-art">
                    <AlbumArt track={track} size={34} radius={8}/>
                    {playing && (
                      <span className="aura-dock__eq" aria-hidden="true"><i/><i/><i/></span>
                    )}
                  </span>
                  <span className="aura-dock__np-meta">
                    <span className="aura-dock__np-title">{cleanTitle(track.title)}</span>
                    <span className="aura-dock__np-artist">{(track.artist ?? '').toLowerCase()}</span>
                  </span>
                </button>
                <button type="button" aria-label={playing ? 'pause' : 'play'}
                  className="aura-dock__np-play" tabIndex={btt ? -1 : 0}
                  onClick={(e) => { e.stopPropagation(); onTogglePlay?.(); }}>
                  {playing
                    ? <svg width="10" height="12" viewBox="0 0 12 14"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
                    : <svg width="10" height="12" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
                </button>
                {/* Progress hairline at the seam — accent line scaled by progress. */}
                <span className="aura-dock__progress" aria-hidden="true"
                  style={{ '--np-progress': Math.max(0, Math.min(1, progress)) }}/>
              </div>
            )}
          </div>
        </div>

        {/* Nav row — crossfades with the centered back-to-top label. During the
            morph the real nav items converge to centre and metaball-melt together
            under #aura-goo (goo rides the actual icons, not decorative blobs). */}
        <div className="aura-dock__nav">
          <div className="aura-dock__nav-items" aria-hidden={btt}>
            {NAV_ITEMS.map(it => {
              if (it.talk) {
                return (
                  <button key="talk" type="button" onClick={onTalk}
                    aria-label="talk" data-tour="mnav-talk" tabIndex={btt ? -1 : 0}
                    className="aura-dock__item aura-dock__item--talk">
                    {it.icon}
                    <span className="aura-dock__label">talk</span>
                  </button>
                );
              }
              const on = active === it.id || (it.id === 'home' && HOME_STACK.has(active));
              return (
                <button key={it.id} type="button" onClick={() => onNav(it.id)} data-tour={`mnav-${it.id}`}
                  tabIndex={btt ? -1 : 0}
                  className={`aura-dock__item ${on ? 'aura-dock__item--on' : ''}`}>
                  {it.icon}
                  <span className="aura-dock__label">{it.label}</span>
                </button>
              );
            })}
          </div>

          <button type="button" className="aura-dock__btt"
            onClick={onBackToTop} tabIndex={btt ? 0 : -1} aria-hidden={!btt} aria-label="Back to top">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 11.5 V3 M3 7 L7 3 L11 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Take me back up</span>
          </button>
        </div>
      </div>
    </div>
  );
}

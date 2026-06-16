import { useEffect, useRef, useState } from 'react';
import { ICON } from '../primitives';
import { AlbumArt } from '../album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import './MobileBottomBar.css';

// Unified mobile chrome — single glass bar at the bottom that combines the
// now-playing strip + nav. Replaces the stacked BottomMiniBar pill + BottomNav
// pair that consumed ~170px of vertical chrome on mobile.
//
// Layout: [art] [title/artist] [play/pause]   |  [home] [search] [talk] [you]
// When no track is loaded, the now-playing block is hidden and the nav
// expands to fill the bar.
//
// `mode` lets the whole bar liquid-morph into a centered "Take me back up"
// pill while the active screen is scrolled (see useActiveScroll): the glass
// pill contracts, the bar contents melt out and the back-to-top label fuses in.
// A goo filter rides the inner content layer for the ~morph duration only.

// Speech-bubble glyph with three conversation dots — matches the NavRail's
// "ask aura" icon so the talk affordance reads as the same thing across
// mobile bar + desktop nav rail.
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

export function MobileBottomBar({
  track, playing,
  onTogglePlay, onOpenPlayer,
  active, onNav, onTalk,
  mode = 'bar', onBackToTop,
}) {
  const btt = mode === 'backtotop';
  // Apply the goo filter only for the morph's duration — at rest it would just
  // blur the bar contents. Skip the very first render so the bar doesn't morph
  // on mount.
  const [morphing, setMorphing] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setMorphing(true);
    const id = setTimeout(() => setMorphing(false), 460);
    return () => clearTimeout(id);
  }, [mode]);

  return (
    <div className={`aura-mobile-bar${btt ? ' aura-mobile-bar--btt' : ''}${morphing ? ' aura-mobile-bar--morphing' : ''}`}>
      <div className="aura-mobile-bar__morph">
        <div className="aura-mobile-bar__face" aria-hidden={btt}>
          {track ? (
            <>
              <button type="button" className="aura-mobile-bar__np" data-tour="mnav-np"
                tabIndex={btt ? -1 : 0} onClick={onOpenPlayer}>
                <span className="aura-mobile-bar__art">
                  <AlbumArt track={track} size={36} radius={9999}/>
                </span>
                <span className="aura-mobile-bar__meta">
                  <span className="aura-mobile-bar__title">{cleanTitle(track.title)}</span>
                  <span className="aura-mobile-bar__artist">{(track.artist ?? '').toLowerCase()}</span>
                </span>
              </button>
              <button type="button" aria-label={playing ? 'pause' : 'play'}
                className="aura-mobile-bar__play" tabIndex={btt ? -1 : 0}
                onClick={(e) => { e.stopPropagation(); onTogglePlay?.(); }}>
                {playing
                  ? <svg width="10" height="12" viewBox="0 0 12 14"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
                  : <svg width="10" height="12" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
              </button>
              <span className="aura-mobile-bar__divider" aria-hidden="true"/>
            </>
          ) : (
            <>
              <button type="button"
                className="aura-mobile-bar__np aura-mobile-bar__np--empty"
                data-tour="mnav-np" tabIndex={btt ? -1 : 0}
                onClick={() => onNav('search')}>
                <span className="aura-mobile-bar__art aura-mobile-bar__art--empty" aria-hidden="true">
                  <svg width="12" height="14" viewBox="0 0 12 14"><path d="M1 1 L11 7 L1 13 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                </span>
                <span className="aura-mobile-bar__meta">
                  <span className="aura-mobile-bar__title">nothing playing</span>
                  <span className="aura-mobile-bar__artist">tap to pick a track</span>
                </span>
              </button>
              <span className="aura-mobile-bar__divider" aria-hidden="true"/>
            </>
          )}
          <div className="aura-mobile-bar__nav">
            {NAV_ITEMS.map(it => {
              if (it.talk) {
                return (
                  <button key="talk" type="button" onClick={onTalk}
                    aria-label="talk" data-tour="mnav-talk" tabIndex={btt ? -1 : 0}
                    className="aura-mobile-bar__nav-item aura-mobile-bar__nav-item--talk">
                    {it.icon}
                    <span className="aura-mobile-bar__nav-label">talk</span>
                  </button>
                );
              }
              const on = active === it.id || (it.id === 'home' && HOME_STACK.has(active));
              return (
                <button key={it.id} type="button" onClick={() => onNav(it.id)} data-tour={`mnav-${it.id}`}
                  tabIndex={btt ? -1 : 0}
                  className={`aura-mobile-bar__nav-item ${on ? 'aura-mobile-bar__nav-item--on' : ''}`}>
                  {it.icon}
                  <span className="aura-mobile-bar__nav-label">{it.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <button type="button" className="aura-mobile-bar__btt"
          onClick={onBackToTop} tabIndex={btt ? 0 : -1} aria-hidden={!btt} aria-label="Back to top">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 11.5 V3 M3 7 L7 3 L11 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Take me back up</span>
        </button>
      </div>
    </div>
  );
}

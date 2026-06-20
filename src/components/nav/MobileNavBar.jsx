import { useEffect, useRef, useState } from 'react';
import { ICON } from '../primitives';
import './MobileNavBar.css';

// Phone nav pill — pinned at the very bottom (bottom:16, never moves) and split
// out from the old combined MobileBottomBar so the now-playing strip can live in
// its own pill above it (see MobileNowPlayingBar). Carries home/search/talk/you
// plus the liquid back-to-top morph.
//
// `mode` lets the whole pill liquid-morph into a centered "Take me back up" pill
// while the active screen is scrolled (see useActiveScroll): the glass contracts,
// the nav items melt out and the back-to-top label fuses in. A goo filter rides
// the inner content layer for the morph's duration only (it would otherwise blur
// the resting bar).

// Speech-bubble glyph with three conversation dots — matches the NavRail's
// "ask aura" icon so the talk affordance reads as the same thing across the
// mobile nav bar + desktop nav rail.
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

export function MobileNavBar({ active, onNav, onTalk, mode = 'bar', onBackToTop }) {
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
    <div className={`aura-nav-bar${btt ? ' aura-nav-bar--btt' : ''}${morphing ? ' aura-nav-bar--morphing' : ''}`}>
      <div className="aura-nav-bar__morph">
        <div className="aura-nav-bar__face" aria-hidden={btt}>
          <div className="aura-nav-bar__nav">
            {NAV_ITEMS.map(it => {
              if (it.talk) {
                return (
                  <button key="talk" type="button" onClick={onTalk}
                    aria-label="talk" data-tour="mnav-talk" tabIndex={btt ? -1 : 0}
                    className="aura-nav-bar__item aura-nav-bar__item--talk">
                    {it.icon}
                    <span className="aura-nav-bar__label">talk</span>
                  </button>
                );
              }
              const on = active === it.id || (it.id === 'home' && HOME_STACK.has(active));
              return (
                <button key={it.id} type="button" onClick={() => onNav(it.id)} data-tour={`mnav-${it.id}`}
                  tabIndex={btt ? -1 : 0}
                  className={`aura-nav-bar__item ${on ? 'aura-nav-bar__item--on' : ''}`}>
                  {it.icon}
                  <span className="aura-nav-bar__label">{it.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <button type="button" className="aura-nav-bar__btt"
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

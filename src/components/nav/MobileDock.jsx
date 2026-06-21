import { useEffect, useRef, useState } from 'react';
import { ICON } from '../primitives';
import { AlbumArt } from '../album/AlbumArt';
import { CircularDial } from '../primitives/CircularDial';
import { cleanTitle } from '../../utils/title';
import './MobileDock.css';

// Mercury dock — ONE glass nav capsule; when a track is playing a circular
// now-playing BEAD buds off the capsule's left end through the #aura-goo metaball
// filter (one liquid blob "growing a head", never two stacked strips). Layout:
//
//   (●)══[ home   search   talk   you ]
//    ^bead    ^nav capsule
//
//   - tap the bead body/ring → the cover morphs UP into the full player (App
//     routes the bead's art element through morphInto)
//   - the centered glyph toggles play/pause (stops propagation)
//   - the bead's ring (CircularDial) shows playback progress
//
// While the active screen is scrolled (mode==='backtotop') the whole dock liquid-
// contracts to a centered "Take me back up" pill — the bead retracts, the nav
// items melt to centre and metaball-fuse. The goo rides the whole dock for the
// morph window ONLY (bead bud + back-to-top); at rest there's no filter
// (`filter` and `backdrop-filter` fight, so it can't live on the glass at rest).

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
  const hasTrack = !!track;
  const artRef = useRef(null);

  // Goo only for the morph window — at rest it would just blur the content and
  // fight the backdrop-filter. ONE window covers both the back-to-top contraction
  // (mode) AND the idle<->playing bead bud (track presence). Skip first render so
  // it doesn't morph on mount.
  const [morphing, setMorphing] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setMorphing(true);
    // Match the morph CSS transitions (~360ms) so the goo filter drops as the
    // morph settles instead of lingering blur on the content after it's done.
    const id = setTimeout(() => setMorphing(false), 380);
    return () => clearTimeout(id);
  }, [mode, hasTrack]);

  return (
    <div className={`aura-dock${track ? ' aura-dock--np' : ''}${btt ? ' aura-dock--btt' : ''}${morphing ? ' aura-dock--morphing' : ''}`}>
      {/* Now-playing bead — buds off the capsule's left end when a track plays. */}
      {track && (
        <div className="aura-dock__bead">
          <button type="button" className="aura-dock__bead-open" data-tour="mnav-np"
            tabIndex={btt ? -1 : 0}
            aria-label={`open player — ${cleanTitle(track.title)}${track.artist ? ` by ${track.artist}` : ''}`}
            onClick={() => onOpenPlayer?.(artRef.current)}>
            <span ref={artRef} className="aura-dock__bead-art">
              <AlbumArt track={track} size={46} radius={999} style={{ width: '100%', height: '100%' }}/>
            </span>
            <span className="aura-dock__bead-ring" aria-hidden="true">
              <CircularDial size={52} stroke={2.5} progress={Math.max(0, Math.min(1, progress))}
                accent="var(--color-accent)" track="var(--color-line)"/>
            </span>
          </button>
          <button type="button" className="aura-dock__bead-play"
            tabIndex={btt ? -1 : 0} aria-label={playing ? 'pause' : 'play'}
            onClick={(e) => { e.stopPropagation(); onTogglePlay?.(); }}>
            {playing
              ? <svg width="10" height="12" viewBox="0 0 12 14"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
              : <svg width="10" height="12" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
          </button>
        </div>
      )}

      {/* Nav capsule — the glass pill. The nav row crossfades with the centered
          back-to-top label; during the back-to-top morph the real nav items
          converge to centre and metaball-fuse under #aura-goo. */}
      <div className="aura-dock__capsule">
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
  );
}

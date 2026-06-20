import { useRef } from 'react';
import { AlbumArt } from '../album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import './MobileNowPlayingBar.css';

// Phone now-playing strip — a glass pill stacked just above MobileNavBar,
// rendered only while a track is loaded. Tapping the art/meta morphs the cover
// up into the full player: App routes the tapped art element through morphInto,
// so the open reads as the bar growing into the screen (same shared-element
// morph every other open path uses). The play/pause disc stops propagation so
// it toggles playback without opening the player.
//
// `hidden` fades + slides the strip away while the active screen is scrolled —
// the nav bar contracts to its centered back-to-top pill then, and a wide strip
// shouldn't hang over it.
export function MobileNowPlayingBar({ track, playing, onTogglePlay, onOpenPlayer, hidden = false }) {
  const artRef = useRef(null);

  return (
    <div className={`aura-np-bar${hidden ? ' aura-np-bar--hidden' : ''}`}>
      <button type="button" className="aura-np-bar__open" data-tour="mnav-np"
        tabIndex={hidden ? -1 : 0} onClick={() => onOpenPlayer?.(artRef.current)}>
        <span ref={artRef} className="aura-np-bar__art">
          <AlbumArt track={track} size={40} radius={9}/>
        </span>
        <span className="aura-np-bar__meta">
          <span className="aura-np-bar__title">{cleanTitle(track.title)}</span>
          <span className="aura-np-bar__artist">{(track.artist ?? '').toLowerCase()}</span>
        </span>
      </button>
      <button type="button" aria-label={playing ? 'pause' : 'play'}
        className="aura-np-bar__play" tabIndex={hidden ? -1 : 0}
        onClick={(e) => { e.stopPropagation(); onTogglePlay?.(); }}>
        {playing
          ? <svg width="11" height="13" viewBox="0 0 12 14"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
          : <svg width="11" height="13" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
      </button>
    </div>
  );
}

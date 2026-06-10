import { AlbumArt } from '../album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import { EqualizerControl } from './Equalizer';
import './BottomMiniBar.css';

export function BottomMiniBar({ track, progress = 0, playing, player, onTogglePlay, onPrev, onNext, onOpenPlayer }) {
  if (!track) return null;
  return (
    <div className="aura-bottom-mini">
      <button type="button" className="aura-bottom-mini__open" onClick={() => onOpenPlayer?.()}>
        <span className="aura-bottom-mini__art">
          <AlbumArt track={track} size={56} radius={10}/>
        </span>
        <span key={track.id} className="aura-bottom-mini__meta aura-track-text">
          <span className="aura-bottom-mini__title">{cleanTitle(track.title)}</span>
          <span className="aura-bottom-mini__artist">{(track.artist ?? '').toLowerCase()}</span>
        </span>
      </button>
      {player && <EqualizerControl player={player} compact/>}
      <div className="aura-bottom-mini__ctrls">
        <button type="button" aria-label="previous"
          onClick={onPrev}
          className="aura-bottom-mini__btn">
          <svg width="14" height="10" viewBox="0 0 14 10"><path d="M14 0 L5 5 L14 10 Z M3 0 H1 V10 H3 Z" fill="currentColor"/></svg>
        </button>
        <button type="button" aria-label={playing ? 'pause' : 'play'}
          onClick={onTogglePlay}
          className="aura-bottom-mini__btn aura-bottom-mini__btn--play">
          {playing
            ? <svg width="12" height="14" viewBox="0 0 12 14"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
            : <svg width="12" height="14" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
        </button>
        <button type="button" aria-label="next"
          onClick={onNext}
          className="aura-bottom-mini__btn">
          <svg width="14" height="10" viewBox="0 0 14 10"><path d="M0 0 L9 5 L0 10 Z M11 0 H13 V10 H11 Z" fill="currentColor"/></svg>
        </button>
      </div>
      <div className="aura-bottom-mini__progress" style={{ '--progress': progress }}/>
    </div>
  );
}

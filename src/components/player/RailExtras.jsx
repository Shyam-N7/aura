import { MonoLabel } from '../primitives';
import { AlbumArt } from '../album/AlbumArt';
import { useRelated } from './useRelated';
import { cleanTitle } from '../../utils/title';
import { toggleTrackMenu } from '../../lib/trackContextMenu';
import './RailExtras.css';

// "more like this" — small shelf of related tracks under NowPlaying in the
// right rail. Each row has a hover-revealed play disc + ⋯ overflow menu.
export function RailExtras({ track, onPickLive }) {
  const trackId = track?.id;
  const trackLang = track?.language;
  const { status, tracks, error } = useRelated(trackId, trackLang);

  if (!track) return null;

  const playNow = (t) => onPickLive?.(t);

  return (
    <div className="aura-rail-extras">
      <div className="aura-rail-extras__divider"/>
      <div className="aura-rail-extras__section">
        <MonoLabel className="text-ink-faint mb-2 block" size={9}>more like this</MonoLabel>
        {status === 'loading' && (
          <div className="aura-rail-extras__loading">
            <span className="aura-rail-extras__loading-dot"/>
            <span className="aura-rail-extras__loading-text">finding the best ones for you…</span>
          </div>
        )}
        {status === 'error' && (
          <div className="font-serif italic text-[14px] text-ink-faint text-pretty">
            couldn’t reach the dj — {error}.{' '}
            <span className="text-ink-faint/80">try restarting the server.</span>
          </div>
        )}
        {status === 'ok' && tracks.length === 0 && (
          <div className="font-serif italic text-[14px] text-ink-faint">
            nothing similar surfaced.
          </div>
        )}
        {status === 'ok' && tracks.length > 0 && (
          <div className="aura-rail-extras__list">
            {tracks.slice(0, 6).map(t => (
              <div key={t.id} className="aura-rail-extras__row-wrap">
                <button onClick={() => playNow(t)} className="aura-rail-extras__row">
                  <AlbumArt track={t} size={36} radius={4}/>
                  <div className="flex-1 min-w-0">
                    <div className="aura-rail-extras__row-title">{cleanTitle(t.title)}</div>
                    <MonoLabel className="text-ink-soft mt-[2px] block truncate" size={8.5}>
                      {(t.artist ?? '').toLowerCase()}
                    </MonoLabel>
                  </div>
                </button>
                <button type="button" aria-label="play"
                  onClick={(e) => { e.stopPropagation(); playNow(t); }}
                  className="aura-rail-extras__row-play">
                  <svg width="9" height="11" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>
                </button>
                <button type="button" aria-label="more" data-track-menu-trigger
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    toggleTrackMenu({ track: t, x: r.right, y: r.bottom });
                  }}
                  className="aura-rail-extras__row-more">
                  <svg width="3" height="14" viewBox="0 0 4 16">
                    <circle cx="2" cy="3"  r="1.4" fill="currentColor"/>
                    <circle cx="2" cy="8"  r="1.4" fill="currentColor"/>
                    <circle cx="2" cy="13" r="1.4" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { MonoLabel } from '../primitives';
import { AlbumArt } from '../album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import { openTrackMenu } from '../../lib/trackContextMenu';
import './MoreLikeThisCarousel.css';

// "more like this" — related-songs list for the phone/tablet player
// (DesktopPlayer). Presentational: the related fetch lives in DesktopPlayer via
// useRelated and is passed in here, so the same list can render in two layout
// spots without firing the request twice. Compact rectangle rows stacked
// vertically — easier to scan than a horizontal carousel users have to
// remember to scroll through. Same actions + copy as the desktop RailExtras.
// (Name kept as "Carousel" for stable imports; the layout is now a list.)
export function MoreLikeThisCarousel({ status, tracks, error, onPlay }) {
  return (
    <div className="aura-mlt">
      <MonoLabel className="aura-mlt__header text-ink-faint block" size={9}>more like this</MonoLabel>

      {status === 'loading' && (
        <div className="aura-mlt__loading">
          <span className="aura-mlt__loading-dot"/>
          <span className="aura-mlt__loading-text">finding the best ones for you…</span>
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
        <div className="aura-mlt__row">
          {tracks.slice(0, 8).map(t => (
            <div key={t.id} className="aura-mlt__card-wrap">
              <button type="button" onClick={() => onPlay?.(t)} className="aura-mlt__card">
                <span className="aura-mlt__art">
                  <AlbumArt track={t} size={44} radius={4}/>
                </span>
                <span className="aura-mlt__card-meta">
                  <span className="aura-mlt__card-title">{cleanTitle(t.title)}</span>
                  <MonoLabel className="aura-mlt__card-artist text-ink-soft" size={9}>
                    {(t.artist ?? '').toLowerCase()}
                  </MonoLabel>
                </span>
              </button>
              <button type="button" aria-label="more"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  openTrackMenu({ track: t, x: r.right, y: r.bottom });
                }}
                className="aura-mlt__more">
                <svg width="4" height="16" viewBox="0 0 4 16">
                  <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                  <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                  <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

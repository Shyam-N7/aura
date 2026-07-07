import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MonoLabel } from '../primitives';
import { AlbumArt } from '../album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import { toast } from '../../lib/toast';
import { ctxPress } from '../../lib/trackContextMenu';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import '../../screens/PlaylistsScreen.css';   // .aura-pl-menu / .aura-pl-menu-item
import './MoreLikeThisCarousel.css';

// "more like this" — related-songs list for the phone/tablet player
// (DesktopPlayer). Presentational: the related fetch lives in DesktopPlayer via
// useRelated and is passed in here, so the same list can render in two layout
// spots without firing the request twice. Compact rectangle rows stacked
// vertically — easier to scan than a horizontal carousel users have to
// remember to scroll through. Same actions + copy as the desktop RailExtras.
// (Name kept as "Carousel" for stable imports; the layout is now a list.)
export function MoreLikeThisCarousel({ status, tracks, error, onPlay, onPlayNext, onAddToQueue }) {
  const [menuId, setMenuId] = useState(null);
  const [menuStyle, setMenuStyle] = useState({ top: 0, bottom: 'auto', right: 0, left: 'auto' });

  // Cards live inside an `overflow-x: auto` scroller (and, in the mobile panel,
  // an `overflow-y: auto` grid), so an `absolute` popover would clip. Pin the
  // menu with `position: fixed` + viewport coords from the ⋯ button, flipping
  // ABOVE it when the button sits low in the viewport. Anchor horizontally
  // based on which half of the viewport the button sits in — anchoring right
  // always (the prior behavior) meant a button near the LEFT edge would push
  // the 160 px menu past x=0, clipping the labels.
  const toggleMenu = (e, t) => {
    e.stopPropagation();
    if (menuId === t.id) { setMenuId(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const GAP = 6;
    // Menu is ~150 px tall (4 items × ~30 px + 6 px outer padding). Flip up
    // whenever the gap below the trigger can't fit menu + breathing room —
    // bumped from 180 to 220 because rows in the lower half of the mlt list
    // were leaving the menu clipped against the viewport bottom.
    const flipUp = window.innerHeight - r.bottom < 220;
    const useLeftAnchor = r.left < window.innerWidth / 2;
    const horizontal = useLeftAnchor
      ? { left: r.left, right: 'auto' }
      : { left: 'auto', right: window.innerWidth - r.right };
    setMenuStyle(flipUp
      ? { top: 'auto', bottom: window.innerHeight - r.top + GAP, ...horizontal }
      : { top: r.bottom + GAP, bottom: 'auto', ...horizontal });
    setMenuId(t.id);
  };

  const close     = () => setMenuId(null);
  const playNow   = (t) => { close(); onPlay?.(t); };
  const playNext  = (t) => { close(); onPlayNext?.(t); toast('queued next.'); };
  const addQueue  = (t) => { close(); onAddToQueue?.(t); toast('added to queue.'); };
  const addToList = (t) => { close(); openAddToPlaylist(t); };

  return (
    <div className="aura-mlt" onClick={close}>
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
            <div key={t.id} className="aura-mlt__card-wrap" {...ctxPress(t)}>
              <button type="button" onClick={() => playNow(t)} className="aura-mlt__card">
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
                onClick={(e) => toggleMenu(e, t)}
                className="aura-mlt__more">
                <svg width="4" height="16" viewBox="0 0 4 16">
                  <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                  <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                  <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                </svg>
              </button>
              {menuId === t.id && createPortal(
                <div className="aura-pl-menu aura-mlt__menu"
                  style={{
                    position: 'fixed',
                    ...menuStyle,
                    marginTop: 0,
                  }}
                  onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => playNow(t)}   className="aura-pl-menu-item">play song</button>
                  <button onClick={() => playNext(t)}  className="aura-pl-menu-item">play next</button>
                  <button onClick={() => addQueue(t)}  className="aura-pl-menu-item">add to queue</button>
                  <button onClick={() => addToList(t)} className="aura-pl-menu-item">add to playlist</button>
                </div>,
                document.body,
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

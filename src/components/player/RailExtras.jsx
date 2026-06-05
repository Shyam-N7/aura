import { useState } from 'react';
import { MonoLabel } from '../primitives';
import { AlbumArt } from '../album/AlbumArt';
import { useRelated } from './useRelated';
import { cleanTitle } from '../../utils/title';
import { toast } from '../../lib/toast';
import { ctxOpen } from '../../lib/trackContextMenu';
import '../../screens/PlaylistsScreen.css';
import './RailExtras.css';

// "more like this" — small shelf of related tracks under NowPlaying in the
// right rail. Each row has a hover-revealed play disc + ⋯ overflow menu.
export function RailExtras({ track, onPickLive, onPlayNext, onAddToQueue, onOpenRailSheet }) {
  const trackId = track?.id;
  const trackLang = track?.language;
  const { status, tracks, error } = useRelated(trackId, trackLang);
  const [menuId, setMenuId] = useState(null);
  const [menuStyle, setMenuStyle] = useState({ top: 0, bottom: 'auto', right: 0, maxHeight: 180 });

  // The "more like this" list lives inside an `overflow-y: auto` scroller, so
  // an `absolute` popover would clip at the scroller's bottom. We pin the menu
  // with `position: fixed` and viewport-relative coords instead (React DOM
  // stays put — no portal). For rows near the viewport bottom, flip the menu
  // ABOVE the row so it never falls off-screen; the menu floats over the
  // prior related rows / lyrics buttons for its brief lifetime, dismissed
  // by outside-click as usual.
  const toggleMenu = (e, t) => {
    e.stopPropagation();
    if (menuId === t.id) { setMenuId(null); return; }
    const row = e.currentTarget.closest('.aura-rail-extras__row-wrap');
    if (row) {
      const DESIRED = 180;
      const GAP = 6;
      const PADDING = 16;
      const r = row.getBoundingClientRect();
      const right = window.innerWidth - r.right + 4;
      const belowSpace = window.innerHeight - r.bottom - GAP - PADDING;
      const aboveSpace = r.top - GAP - PADDING;
      const flipUp = belowSpace < 120 && aboveSpace > belowSpace;
      if (flipUp) {
        setMenuStyle({
          top: 'auto',
          bottom: window.innerHeight - r.top + GAP,
          right,
          maxHeight: Math.max(80, Math.min(DESIRED, aboveSpace)),
        });
      } else {
        setMenuStyle({
          top: r.bottom + GAP,
          bottom: 'auto',
          right,
          maxHeight: Math.max(80, Math.min(DESIRED, belowSpace)),
        });
      }
    }
    setMenuId(t.id);
  };

  if (!track) return null;

  const playNow    = (t) => { setMenuId(null); onPickLive?.(t); };
  const playNext   = (t) => { setMenuId(null); onPlayNext?.(t); toast('queued next.'); };
  const addQueue   = (t) => { setMenuId(null); onAddToQueue?.(t); toast('added to queue.'); };
  const addToList  = (t) => { setMenuId(null); onOpenRailSheet?.(t); };

  return (
    <div className="aura-rail-extras" onClick={() => setMenuId(null)}>
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
              <div key={t.id} className="aura-rail-extras__row-wrap" onContextMenu={ctxOpen(t)}>
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
                <button type="button" aria-label="more"
                  onClick={(e) => toggleMenu(e, t)}
                  className="aura-rail-extras__row-more">
                  <svg width="3" height="14" viewBox="0 0 4 16">
                    <circle cx="2" cy="3"  r="1.4" fill="currentColor"/>
                    <circle cx="2" cy="8"  r="1.4" fill="currentColor"/>
                    <circle cx="2" cy="13" r="1.4" fill="currentColor"/>
                  </svg>
                </button>
                {menuId === t.id && (
                  <div className="aura-pl-menu aura-rail-extras__menu"
                    style={{
                      position: 'fixed',
                      top: menuStyle.top,
                      bottom: menuStyle.bottom,
                      right: menuStyle.right,
                      maxHeight: menuStyle.maxHeight,
                      marginTop: 0,
                    }}
                    onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => playNow(t)}    className="aura-pl-menu-item">play song</button>
                    <button onClick={() => playNext(t)}   className="aura-pl-menu-item">play next</button>
                    <button onClick={() => addQueue(t)}   className="aura-pl-menu-item">add to queue</button>
                    <button onClick={() => addToList(t)}  className="aura-pl-menu-item">add to playlist</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

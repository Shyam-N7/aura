import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getCatalogPlaylist } from '../../api/discover';
import { fmtTime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { ctxOpen } from '../../lib/trackContextMenu';
import { toast } from '../../lib/toast';
import { CrumbBack } from './CrumbBack';
import './DesktopPlaylistDetail.css';

// Read-only editorial playlist from the catalog at desktop. Same shape as
// DesktopPlaylistDetail but no remove (it's not a user-owned list).
export function DesktopCatalogPlaylistDetail({ playlistId, onClose, onPlaySequence, onPlayOne, onPlayNext, onAddToQueue }) {
  const [hit, setHit]       = useState({ data: null, error: null });
  const [menuId, setMenuId] = useState(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getCatalogPlaylist(playlistId, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [playlistId]);

  const tracks = hit.data?.tracks ?? [];
  const playAll = () => {
    if (tracks.length) onPlaySequence(tracks, 0, (hit.data?.name ?? 'this playlist').toLowerCase());
  };

  const playOne    = (t) => { setMenuId(null); onPlayOne?.(t); };
  const playNext   = (t) => { setMenuId(null); onPlayNext?.(t); toast('Queued next.'); };
  const addToQueue = (t) => { setMenuId(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList  = (t) => { setMenuId(null); openAddToPlaylist(t); };

  return (
    <div className="aura-dpd" onClick={() => setMenuId(null)}>
      <div className="aura-dpd__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
          <MonoLabel className="text-ink-faint" size={10}>
            playlist{hit.data ? ` · ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}` : ''}
          </MonoLabel>
        </div>

        {status === 'loading' && (
          <AuraLoader label="Loading playlist"/>
        )}
        {status === 'error' && (
          <div className="aura-dpd__error">
            Couldn’t load — {hit.error}
          </div>
        )}
        {status === 'ok' && (
          <>
            <h1 className="aura-dpd__hero">
              <em>{hit.data.name}</em>.
            </h1>
            {tracks.length > 0 && (
              <div className="mt-7">
                <button onClick={playAll} className="aura-dpd__play-all">
                  <span className="aura-dpd__play-disc">
                    <svg width="10" height="12" viewBox="0 0 12 14">
                      <path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/>
                    </svg>
                  </span>
                  Play all
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="aura-dpd__scroll">
        {status === 'ok' && tracks.length > 0 && (
          <div className="aura-dpd__list">
            {tracks.map((t, i) => (
              <div key={t.id} className="aura-dpd__row" onContextMenu={ctxOpen(t)}>
                <div className="aura-dpd__idx">{String(i + 1).padStart(2, '0')}</div>
                <button onClick={(e) => onPlaySequence(tracks, i, (hit.data?.name ?? '').toLowerCase(), e.currentTarget)}
                  className="aura-dpd__main">
                  <AlbumArt track={t} size={54} radius={4}/>
                  <div className="flex-1 min-w-0">
                    <div className="aura-dpd__title">{cleanTitle(t.title)}</div>
                    <MonoLabel className="text-ink-soft mt-1.5 block truncate" size={9.5}>
                      {(t.artist ?? '').toLowerCase()} · {t.language ?? ''}
                    </MonoLabel>
                  </div>
                  <MonoLabel className="text-ink-faint shrink-0 ml-4" size={10} numeric>{fmtTime(t.durationSec)}</MonoLabel>
                </button>
                <div className="relative">
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuId(m => m === t.id ? null : t.id); }}
                    aria-label="more"
                    className="aura-dpd__more">
                    <svg width="4" height="16" viewBox="0 0 4 16">
                      <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                      <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                      <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                    </svg>
                  </button>
                  {menuId === t.id && (
                    <div className="aura-pl-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => playOne(t)}    className="aura-pl-menu-item">play song</button>
                      <button onClick={() => playNext(t)}   className="aura-pl-menu-item">play next</button>
                      <button onClick={() => addToQueue(t)} className="aura-pl-menu-item">add to queue</button>
                      <button onClick={() => addToList(t)}  className="aura-pl-menu-item">add to my playlist</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

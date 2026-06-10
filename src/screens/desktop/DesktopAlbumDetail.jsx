import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getAlbum } from '../../api/catalog';
import { fmtTime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { toast } from '../../lib/toast';
import { CrumbBack } from './CrumbBack';
import '../PlaylistsScreen.css'; // .aura-pl-menu-item (AnchoredMenu items)
import './DesktopPlaylistDetail.css'; // reuse the .aura-dpd detail layout

// Album / movie detail. Indian-cinema soundtracks are albums with isMovie; the
// eyebrow names it a movie or album. Same layout as the catalog playlist detail.
export function DesktopAlbumDetail({ albumId, onClose, onPlaySequence, onPlayOne, onPlayNext, onAddToQueue }) {
  const [hit, setHit] = useState({ data: null, error: null });
  const [menu, setMenu] = useState(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getAlbum(albumId, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [albumId]);

  const tracks = hit.data?.tracks ?? [];
  const kind = hit.data?.isMovie ? 'movie' : 'album';
  const playAll = () => {
    if (tracks.length) onPlaySequence(tracks, 0, (hit.data?.name ?? `this ${kind}`).toLowerCase());
  };

  const playOne    = (t) => { setMenu(null); onPlayOne?.(t); };
  const playNext   = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addToQueue = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList  = (t) => { setMenu(null); openAddToPlaylist(t); };

  const eyebrow = hit.data
    ? [kind, hit.data.artist, `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`].filter(Boolean).join(' · ')
    : kind;

  return (
    <div className="aura-dpd" onClick={() => setMenu(null)}>
      <div className="aura-dpd__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
          <MonoLabel className="text-ink-faint" size={10}>{eyebrow}</MonoLabel>
        </div>

        {status === 'loading' && <AuraLoader label={`Loading ${kind}`}/>}
        {status === 'error' && <div className="aura-dpd__error">Couldn’t load — {hit.error}</div>}
        {status === 'ok' && (
          <>
            <h1 className="aura-dpd__hero"><em>{hit.data.name}</em>.</h1>
            {tracks.length > 0 && (
              <div className="mt-7">
                <button onClick={playAll} className="aura-dpd__play-all">
                  <span className="aura-dpd__play-disc">
                    <svg width="10" height="12" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>
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
                    onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setMenu(m => m?.id === t.id ? null : { id: t.id, el }); }}
                    aria-label="more" className="aura-dpd__more">
                    <svg width="4" height="16" viewBox="0 0 4 16">
                      <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                      <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                      <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                    </svg>
                  </button>
                  {menu?.id === t.id && (
                    <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={166}>
                      <button onClick={() => playOne(t)}    className="aura-pl-menu-item">play song</button>
                      <button onClick={() => playNext(t)}   className="aura-pl-menu-item">play next</button>
                      <button onClick={() => addToQueue(t)} className="aura-pl-menu-item">add to queue</button>
                      <button onClick={() => addToList(t)}  className="aura-pl-menu-item">add to my playlist</button>
                    </AnchoredMenu>
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

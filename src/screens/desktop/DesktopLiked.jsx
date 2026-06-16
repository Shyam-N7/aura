import { useEffect, useState } from 'react';
import { MonoLabel, HeartButton } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { listLiked } from '../../api/likes';
import { useLikes } from '../../hooks/useLikes';
import { fmtTime, fmtRuntime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { toast } from '../../lib/toast';
import { CrumbBack } from './CrumbBack';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { BackToTop } from '../../components/BackToTop';
import '../PlaylistsScreen.css';
import './DesktopPlaylistDetail.css';

// Full-page "your liked" for desktop. Same pinned-header pattern as
// DesktopPlaylistDetail (Batch 25): hero stays parked, only the row list
// scrolls. Liked is effectively a single-purpose playlist so we reuse the
// `aura-dpd__*` classnames for zero duplication.
export function DesktopLiked({ onClose, onPlaySequence, onPickLive, onPlayNext, onAddToQueue }) {
  const [hit, setHit] = useState({ data: null, error: null });
  const [menu, setMenu] = useState(null);
  const { isLiked } = useLikes();
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';
  const scrollRef = useScrollMemory('liked', { ready: status === 'ok' });

  useEffect(() => {
    const ctl = new AbortController();
    listLiked({ signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, []);

  // Keep the local list in sync as the user unlikes from this screen.
  const liked = (hit.data ?? []).filter(t => isLiked(t.id));

  const playAll = () => {
    if (liked.length) onPlaySequence(liked, 0, 'your liked');
  };

  const playOne     = (t) => { setMenu(null); onPickLive?.(t); };
  const playNext    = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addToQueue  = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList   = (t) => { setMenu(null); openAddToPlaylist(t); };

  return (
    <div ref={scrollRef} className="aura-dpd" onClick={() => setMenu(null)}>
      <div className="aura-dpd__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
        </div>

        {status === 'loading' && (
          <AuraLoader label="Loading liked songs"/>
        )}
        {status === 'error' && (
          <div className="aura-dpd__error">
            Couldn’t load — {hit.error}
          </div>
        )}
        {status === 'ok' && (
          <>
            <div className="aura-dpd__kind">your collection</div>
            <h1 className="aura-dpd__hero">liked</h1>
            {liked.length > 0 && <div className="aura-dpd__by">by you</div>}
            {liked.length > 0 && (
              <div className="mt-6">
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
        {status === 'ok' && liked.length === 0 && (
          <div className="aura-dpd__empty">
            <div className="aura-dpd__empty-title">No liked songs yet.</div>
            <div className="aura-dpd__empty-body">
              Tap the heart on any song to start your collection.
            </div>
          </div>
        )}

        {status === 'ok' && liked.length > 0 && (
          <div className="aura-dpd__list">
            <div className="aura-dpd__count">
              <span>{liked.length} {liked.length === 1 ? 'song' : 'songs'}</span>-
              <span>{fmtRuntime(liked.reduce((s, t) => s + (t.durationSec || 0), 0))}</span>
            </div>
            {liked.map((t, i) => (
              <div key={t.id} className="aura-dpd__row" onContextMenu={ctxOpen(t)}>
                <div className="aura-dpd__idx">{String(i + 1).padStart(2, '0')}</div>
                <button onClick={(e) => onPlaySequence(liked, i, 'your liked', e.currentTarget)}
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
                <div className="relative flex items-center gap-2">
                  <HeartButton trackId={t.id} size={18}/>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setMenu(m => m?.id === t.id ? null : { id: t.id, el }); }}
                    aria-label="more"
                    className="aura-dpd__more">
                    <svg width="4" height="16" viewBox="0 0 4 16">
                      <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                      <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                      <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                    </svg>
                  </button>
                  {menu?.id === t.id && (
                    <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={166}>
                      <button onClick={() => playOne(t)}     className="aura-pl-menu-item">play song</button>
                      <button onClick={() => playNext(t)}    className="aura-pl-menu-item">play next</button>
                      <button onClick={() => addToQueue(t)}  className="aura-pl-menu-item">add to queue</button>
                      <button onClick={() => addToList(t)}   className="aura-pl-menu-item">add to playlist</button>
                    </AnchoredMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <BackToTop scrollRef={scrollRef}/>
    </div>
  );
}

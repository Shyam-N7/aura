import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getPlaylist, removeFromPlaylist, getPlaylistRev, createPlaylistInvite } from '../../api/playlists';
import { fmtTime, fmtRuntime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { toast } from '../../lib/toast';
import { confirm } from '../../lib/confirm';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { CrumbBack } from './CrumbBack';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { BackToTop } from '../../components/BackToTop';
import '../PlaylistsScreen.css'; // .aura-pl-menu-item (AnchoredMenu items)
import './DesktopPlaylistDetail.css';

export function DesktopPlaylistDetail({ playlistId, onClose, onPlaySequence, onPlayOne, onPlayNext, onAddToQueue }) {
  const [hit, setHit]     = useState({ data: null, error: null });
  const [menu, setMenu] = useState(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';
  const scrollRef = useScrollMemory(`playlist:${playlistId}`, { ready: status === 'ok' });

  useEffect(() => {
    const ctl = new AbortController();
    getPlaylist(playlistId, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [playlistId]);

  const tracks = hit.data?.tracks ?? [];
  const canEdit = hit.data?.canEdit ?? false;
  const isOwner = hit.data?.role === 'owner';
  const shared = hit.data?.shared ?? false;
  const collaborators = hit.data?.collaborators ?? [];
  const updatedAt = hit.data?.updatedAt;

  // Live sync for shared playlists — poll the cheap rev cursor while the screen
  // is open + visible, and refetch the full playlist when a collaborator changed
  // it. Cleared on unmount; skips while the tab is hidden.
  useEffect(() => {
    if (!shared) return undefined;
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      try {
        const { updatedAt: rev } = await getPlaylistRev(playlistId);
        if (stop || !rev || rev === updatedAt) return;
        const data = await getPlaylist(playlistId);
        if (!stop) setHit({ data, error: null });
      } catch { /* transient — next tick retries */ }
    };
    const id = setInterval(tick, 15000);
    return () => { stop = true; clearInterval(id); };
  }, [playlistId, shared, updatedAt]);

  const share = async () => {
    try {
      const { token } = await createPlaylistInvite(playlistId);
      const link = `${window.location.origin}/playlists?join=${token}`;
      try { await navigator.clipboard.writeText(link); toast('Share link copied — anyone you send it to can edit.'); }
      catch { toast(link); }
    } catch (err) {
      toast(`Couldn’t create a link — ${err.message}`);
    }
  };

  const remove = async (track) => {
    setMenu(null);
    const ok = await confirm({
      title: `Remove “${track.title}”?`,
      body:  'This only removes it from this playlist. Your likes are untouched.',
      confirmLabel: 'remove',
      danger: true,
    });
    if (!ok) return;
    const prev = hit.data;
    setHit(h => ({
      ...h,
      data: { ...h.data, tracks: h.data.tracks.filter(t => t.id !== track.id), trackCount: h.data.trackCount - 1 },
    }));
    try {
      await removeFromPlaylist(playlistId, track.id);
      toast('Removed.');
    } catch (err) {
      setHit({ data: prev, error: null });
      toast(`Couldn’t remove — ${err.message}`);
    }
  };

  const playOne = (track) => { setMenu(null); onPlayOne?.(track); };
  const playNext = (track) => { setMenu(null); onPlayNext?.(track); toast('Queued next.'); };
  const addToQueue = (track) => { setMenu(null); onAddToQueue?.(track); toast('Added to queue.'); };
  const addElsewhere = (track) => { setMenu(null); openAddToPlaylist(track); };

  const playAll = () => {
    if (tracks.length) onPlaySequence(tracks, 0, (hit.data?.name ?? 'this playlist').toLowerCase());
  };

  return (
    <div ref={scrollRef} className="aura-dpd" onClick={() => setMenu(null)}>
      <div className="aura-dpd__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
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
            <div className="aura-dpd__kind">playlist{shared ? ' · shared' : ''}</div>
            <h1 className="aura-dpd__hero">{hit.data.name}</h1>
            <div className="aura-dpd__by">
              {isOwner ? 'by you' : `by ${hit.data.ownerName ?? 'someone'}`}
              {collaborators.length > 0 && ` · ${collaborators.length} ${collaborators.length === 1 ? 'collaborator' : 'collaborators'}`}
            </div>
            <div className="aura-dpd__actions">
              {tracks.length > 0 && (
                <button onClick={playAll} className="aura-dpd__play-all">
                  <span className="aura-dpd__play-disc">
                    <svg width="10" height="12" viewBox="0 0 12 14">
                      <path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/>
                    </svg>
                  </span>
                  Play all
                </button>
              )}
              {isOwner && (
                <button onClick={share} className="aura-dpd__share">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6.5 9.5 L9.5 6.5 M7 4.5 L8.5 3 a2.5 2.5 0 0 1 3.5 3.5 L10.5 8 M9 11.5 L7.5 13 a2.5 2.5 0 0 1 -3.5 -3.5 L5.5 8"
                      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Share
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="aura-dpd__scroll">
        {status === 'ok' && tracks.length === 0 && (
          <div className="aura-dpd__empty">
            <div className="aura-dpd__empty-title">No tracks yet.</div>
            <div className="aura-dpd__empty-body">
              Tap the music-note icon on any song to add it here.
            </div>
          </div>
        )}

        {status === 'ok' && tracks.length > 0 && (
          <div className="aura-dpd__list">
            <div className="aura-dpd__count">
              <span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>-
              <span>{fmtRuntime(tracks.reduce((s, t) => s + (t.durationSec || 0), 0))}</span>
            </div>
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
                    aria-label="more"
                    className="aura-dpd__more">
                    <svg width="4" height="16" viewBox="0 0 4 16">
                      <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                      <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                      <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                    </svg>
                  </button>
                  {menu?.id === t.id && (
                    <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={206}>
                      <button onClick={() => playOne(t)}      className="aura-pl-menu-item">play song</button>
                      <button onClick={() => playNext(t)}     className="aura-pl-menu-item">play next</button>
                      <button onClick={() => addToQueue(t)}   className="aura-pl-menu-item">add to queue</button>
                      <button onClick={() => addElsewhere(t)} className="aura-pl-menu-item">add to another playlist</button>
                      {canEdit && (
                        <button onClick={() => remove(t)} className="aura-pl-menu-item aura-pl-menu-item--danger">
                          remove from this playlist
                        </button>
                      )}
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

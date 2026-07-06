import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getCatalogPlaylist } from '../../api/discover';
import { fmtTime, fmtRuntime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { hideTrack } from '../../api/hidden';
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { toast } from '../../lib/toast';
import { CrumbBack } from './CrumbBack';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { BackToTop } from '../../components/BackToTop';
import { setMeta } from '../../lib/meta';
import '../PlaylistsScreen.css'; // .aura-pl-menu-item (AnchoredMenu items)
import './DesktopPlaylistDetail.css';

// Read-only playlist detail at desktop. Same shape as DesktopPlaylistDetail but
// no remove (it's not a user-owned list). Used for catalog/editorial playlists
// (fetched by id) AND for auto "from your listening" sets, which already carry
// their full tracks in memory — pass them via `initialData` to skip the fetch.
export function DesktopCatalogPlaylistDetail({ playlistId, initialData = null, ownerName = null, onClose, onPlaySequence, onPlayOne, onPlayNext, onAddToQueue }) {
  const [hit, setHit]       = useState({ data: initialData, error: null });
  const [menu, setMenu] = useState(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';
  const scrollRef = useScrollMemory(`catalog:${playlistId}`, { ready: status === 'ok' });

  useEffect(() => {
    if (initialData) return;   // pre-loaded (e.g. an auto playlist) — no fetch
    const ctl = new AbortController();
    getCatalogPlaylist(playlistId, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [playlistId, initialData]);

  const tracks = hit.data?.tracks ?? [];

  // Name-based tab title + JSON-LD once the playlist loads. No cleanup — the
  // App-level screen-title effect re-asserts on every navigation.
  const playlistName = hit.data?.name;
  useEffect(() => {
    if (!playlistName) return;
    setMeta({
      title: `${playlistName} · AURA`,
      jsonLd: { '@type': 'MusicPlaylist', name: playlistName, url: window.location.href },
    });
  }, [playlistName]);

  const playAll = () => {
    if (tracks.length) onPlaySequence(tracks, 0, (hit.data?.name ?? 'this playlist').toLowerCase());
  };

  const playOne    = (t) => { setMenu(null); onPlayOne?.(t); };
  const playNext   = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addToQueue = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList  = (t) => { setMenu(null); openAddToPlaylist(t); };

  // "Don't show this again" — only on the made-for-you mixes (a catalog list
  // isn't a pick of ours to apologise for). Removes the row immediately; the
  // undo lives in Settings → hidden songs.
  const isAutoMix = initialData?.kind === 'auto';
  const hideOne = async (t) => {
    setMenu(null);
    try {
      await hideTrack(t.id);
      setHit(h => h.data
        ? { ...h, data: { ...h.data, tracks: (h.data.tracks ?? []).filter(x => x.id !== t.id) } }
        : h);
      toast("hidden — aura won't pick this for you again. undo in settings.");
    } catch {
      toast("couldn't hide that — try again.");
    }
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
            {ownerName && (
              <MonoLabel className="text-ink-faint block mb-2" size={10}>shared by {ownerName}</MonoLabel>
            )}
            <h1 className="aura-dpd__hero">
              <em>{hit.data.name}</em>.
            </h1>
            {initialData?.editionLabel && (
              <MonoLabel className="text-ink-faint block mt-3" size={9.5}>
                {initialData.editionLabel}{initialData.refreshing ? ' · refreshing…' : ''} — {initialData.description}
              </MonoLabel>
            )}
            {initialData?.ruleLine && (
              <MonoLabel className="text-ink-faint block mt-1" size={8.5}>{initialData.ruleLine}</MonoLabel>
            )}
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
                    {t.reason && (
                      <MonoLabel className="text-ink-faint mt-1 block truncate" size={8.5}>
                        {t.reason}
                      </MonoLabel>
                    )}
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
                    <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={isAutoMix ? 204 : 166}>
                      <button onClick={() => playOne(t)}    className="aura-pl-menu-item">play song</button>
                      <button onClick={() => playNext(t)}   className="aura-pl-menu-item">play next</button>
                      <button onClick={() => addToQueue(t)} className="aura-pl-menu-item">add to queue</button>
                      <button onClick={() => addToList(t)}  className="aura-pl-menu-item">add to my playlist</button>
                      {isAutoMix && (
                        <button onClick={() => hideOne(t)} className="aura-pl-menu-item">don’t show this again</button>
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

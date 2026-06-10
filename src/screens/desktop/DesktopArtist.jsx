import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getArtist } from '../../api/artists';
import { cleanTitle } from '../../utils/title';
import { fmtTime } from '../../utils/fmtTime';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { toast } from '../../lib/toast';
import { CrumbBack } from './CrumbBack';
import { SectionHeader } from './SectionHeader';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { setMeta } from '../../lib/meta';
import '../PlaylistsScreen.css';
import './DesktopPlaylistDetail.css';
import './DesktopArtist.css';

export function DesktopArtist({
  artistKey, onClose, onPickLive, onPlaySequence, onPlayNext, onAddToQueue, onOpenArtist, onOpenAlbum,
}) {
  const [hit, setHit]       = useState({ data: null, error: null });
  const [menu, setMenu]     = useState(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';
  const scrollRef = useScrollMemory(`artist:${artistKey?.id ?? artistKey?.name ?? ''}`, { ready: status === 'ok' });

  useEffect(() => {
    if (!artistKey) return;
    const ctl = new AbortController();
    getArtist(artistKey, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [artistKey?.id, artistKey?.name]);  // eslint-disable-line react-hooks/exhaustive-deps

  const artist = hit.data;
  const tracks = artist?.topTracks ?? [];
  const albums = artist?.topAlbums ?? [];
  const similar = artist?.similarArtists ?? [];

  // Name-based tab title + JSON-LD once the artist loads. No cleanup — the
  // App-level screen-title effect re-asserts on every navigation.
  useEffect(() => {
    if (!artist?.name) return;
    setMeta({
      title: `${artist.name} · AURA`,
      jsonLd: { '@type': 'MusicGroup', name: artist.name, url: window.location.href },
    });
  }, [artist?.name]);

  const playTop = () => {
    if (tracks.length) onPlaySequence?.(tracks, 0, `${artist.name.toLowerCase()} · top tracks`);
  };

  const playOne     = (t) => { setMenu(null); onPickLive?.(t); };
  const playNextItem = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addToQueue  = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList   = (t) => { setMenu(null); openAddToPlaylist(t); };

  // Use `aura-dpd` classnames for the body so it inherits the existing
  // playlist-detail styling (hero pill, track rows, ⋯ menus). DesktopArtist.css
  // only adds the artist-specific bits (avatar, album grid, similar row).
  return (
    <div ref={scrollRef} className="aura-dpd aura-dar" onClick={() => setMenu(null)}>
      <div className="aura-dpd__header aura-dar__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
          <MonoLabel className="text-ink-faint" size={10}>
            artist{artist?.followerCount ? ` · ${artist.followerCount.toLocaleString()} fans` : ''}
          </MonoLabel>
        </div>

        {status === 'loading' && (
          <AuraLoader label="Loading artist"/>
        )}
        {status === 'error' && (
          <div className="aura-dpd__error">
            Couldn’t find that artist — {hit.error}
          </div>
        )}
        {status === 'ok' && artist && (
          <>
            <div className="aura-dar__hero-row">
              {artist.image
                ? <img src={artist.image} alt="" className="aura-dar__avatar" loading="lazy"/>
                : <span className="aura-dar__avatar aura-dar__avatar--fallback">
                    {(artist.name?.[0] ?? '·').toLowerCase()}
                  </span>}
              <h1 className="aura-dpd__hero"><em>{artist.name.toLowerCase()}</em>.</h1>
            </div>
            {tracks.length > 0 && (
              <div className="mt-6">
                <button onClick={playTop} className="aura-dpd__play-all">
                  <span className="aura-dpd__play-disc">
                    <svg width="10" height="12" viewBox="0 0 12 14">
                      <path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/>
                    </svg>
                  </span>
                  Play top tracks
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="aura-dpd__scroll">
        {status === 'ok' && tracks.length > 0 && (
          <>
            <SectionHeader title="Top tracks" sub="Most-played from this artist" large/>
            <div className="aura-dpd__list">
              {tracks.slice(0, 10).map((t, i) => (
                <div key={t.id} className="aura-dpd__row" onContextMenu={ctxOpen(t)}>
                  <div className="aura-dpd__idx">{String(i + 1).padStart(2, '0')}</div>
                  <button onClick={(e) => onPlaySequence?.(tracks, i, `${artist.name.toLowerCase()} · top tracks`, e.currentTarget)}
                    className="aura-dpd__main">
                    <AlbumArt track={t} size={54} radius={4}/>
                    <div className="flex-1 min-w-0">
                      <div className="aura-dpd__title">{cleanTitle(t.title)}</div>
                      <MonoLabel className="text-ink-soft mt-1.5 block truncate" size={9.5}>
                        {(t.album ?? '').toLowerCase()}{t.language ? ` · ${t.language}` : ''}
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
                      <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={166}>
                        <button onClick={() => playOne(t)}      className="aura-pl-menu-item">play song</button>
                        <button onClick={() => playNextItem(t)} className="aura-pl-menu-item">play next</button>
                        <button onClick={() => addToQueue(t)}   className="aura-pl-menu-item">add to queue</button>
                        <button onClick={() => addToList(t)}    className="aura-pl-menu-item">add to playlist</button>
                      </AnchoredMenu>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {status === 'ok' && albums.length > 0 && (
          <>
            <SectionHeader title="Albums" sub={`${albums.length} ${albums.length === 1 ? 'release' : 'releases'}`} large/>
            <div className="aura-dar__albums">
              {albums.map(album => (
                <button key={album.id} onClick={() => onOpenAlbum?.(album.id)} className="aura-dar__album">
                  {album.image
                    ? <img src={album.image} alt="" loading="lazy" className="aura-dar__album-cover"/>
                    : <span className="aura-dar__album-cover aura-dar__album-cover--fallback">
                        {(album.name?.[0] ?? '·').toLowerCase()}
                      </span>}
                  <div className="aura-dar__album-name">{album.name}</div>
                  {album.year && (
                    <MonoLabel className="text-ink-faint" size={9}>{album.year}</MonoLabel>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {status === 'ok' && similar.length > 0 && (
          <>
            <SectionHeader title="Fans also like" sub="Similar artists" large/>
            <div className="aura-dar__similar">
              {similar.slice(0, 8).map(s => (
                <button key={s.id} onClick={() => onOpenArtist?.({ id: s.id, name: s.name })}
                  className="aura-dar__similar-tile">
                  {s.image
                    ? <img src={s.image} alt="" loading="lazy" className="aura-dar__similar-avatar"/>
                    : <span className="aura-dar__similar-avatar aura-dar__similar-avatar--fallback">
                        {(s.name?.[0] ?? '·').toLowerCase()}
                      </span>}
                  <div className="aura-dar__similar-name">{(s.name ?? '').toLowerCase()}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {status === 'ok' && artist?.bio && (
          <>
            <SectionHeader title="About" large/>
            <p className="aura-dar__bio">{artist.bio}</p>
          </>
        )}
      </div>
    </div>
  );
}

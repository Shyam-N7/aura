import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getLibrarySummary } from '../../api/library';
import { listLiked } from '../../api/likes';
import { listPlaylists } from '../../api/playlists';
import { cleanTitle } from '../../utils/title';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { toast } from '../../lib/toast';
import '../PlaylistsScreen.css';
import './DesktopLibrary.css';

const HOME_LANGS = ['tamil', 'english', 'hindi', 'malayalam', 'kannada'];

export function DesktopLibrary({ onPlaySequence, onPickLive, onPlayNext, onAddToQueue, onOpenLiked, onOpenPlaylistDetail, onOpenLangHub }) {
  const [summary, setSummary]     = useState(null);
  const [liked, setLiked]         = useState(null);
  const [playlists, setPlaylists] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [menu, setMenu]           = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    Promise.all([
      getLibrarySummary({ signal: ctl.signal }).catch(() => null),
      listLiked({ signal: ctl.signal }).catch(() => []),
      listPlaylists({ signal: ctl.signal }).catch(() => []),
    ]).then(([s, l, p]) => { setSummary(s); setLiked(l); setPlaylists(p); setLoading(false); });
    return () => ctl.abort();
  }, []);

  const hasAnyData = summary && summary.tracksPlayed > 0;

  const playNow    = (t) => { setMenu(null); onPickLive?.(t); };
  const playNext   = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addQueue   = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList  = (t) => { setMenu(null); openAddToPlaylist(t); };

  return (
    <div className="aura-dlib" onClick={() => setMenu(null)}>
      <div className="aura-dlib__header">
        <MonoLabel className="text-ink-faint" size={10}>
          library · your year of listening
        </MonoLabel>
        <h1 className="aura-dlib__hero">
          Your <em>listening.</em>
        </h1>
        {summary && (
          <MonoLabel className="text-ink-faint mt-3.5 block" size={10}>
            {summary.tracksPlayed ?? 0} tracks · {summary.minutesListened ?? 0} minutes · top language {summary.topLanguage ?? '—'}
          </MonoLabel>
        )}
      </div>

      <div className="aura-dlib__scroll">
        {loading && <AuraLoader label="Loading library"/>}
        {!loading && !hasAnyData && summary && (
          <div className="aura-dlib__empty">
            Nothing played yet. Your library fills as you listen.
          </div>
        )}

        {!loading && (
        <>
        <div className="aura-dlib__cols">
          <div>
            <div className="flex items-baseline justify-between mb-[18px]">
              <MonoLabel className="text-ink-faint" size={10}>your liked · {liked?.length ?? 0}</MonoLabel>
              {onOpenLiked && liked && liked.length > 0 && (
                <button onClick={onOpenLiked} className="aura-dlib__see-all">SEE ALL →</button>
              )}
            </div>
            {(!liked || liked.length === 0) && (
              <div className="aura-dlib__empty-row">No liked songs yet. Tap the heart on any track.</div>
            )}
            {liked?.length > 0 && liked.slice(0, 10).map((t, i) => (
              <div key={t.id} className="aura-dlib__row-wrap" onContextMenu={ctxOpen(t)}>
                <button onClick={(e) => onPlaySequence?.(liked, i, 'your liked', e.currentTarget)}
                  className="aura-dlib__row">
                  <AlbumArt track={t} size={50} radius={4}/>
                  <div className="flex-1 min-w-0">
                    <div className="aura-dlib__row-title">{cleanTitle(t.title)}</div>
                    <MonoLabel className="text-ink-soft mt-1 block truncate" size={9.5}>
                      {(t.artist ?? '').toLowerCase()} · {t.language ?? ''}
                    </MonoLabel>
                  </div>
                </button>
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setMenu(m => m?.id === t.id ? null : { id: t.id, el }); }}
                  aria-label="more"
                  className="aura-dlib__more">
                  <svg width="4" height="16" viewBox="0 0 4 16">
                    <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                    <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                    <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                  </svg>
                </button>
                {menu?.id === t.id && (
                  <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={166}>
                    <button onClick={() => playNow(t)}    className="aura-pl-menu-item">play song</button>
                    <button onClick={() => playNext(t)}   className="aura-pl-menu-item">play next</button>
                    <button onClick={() => addQueue(t)}   className="aura-pl-menu-item">add to queue</button>
                    <button onClick={() => addToList(t)}  className="aura-pl-menu-item">add to playlist</button>
                  </AnchoredMenu>
                )}
              </div>
            ))}
          </div>

          <div>
            <MonoLabel className="text-ink-faint block mb-[18px]" size={10}>your playlists · {playlists?.length ?? 0}</MonoLabel>
            {(!playlists || playlists.length === 0) && (
              <div className="aura-dlib__empty-row">No playlists yet. Create one from any song’s menu.</div>
            )}
            {playlists?.length > 0 && playlists.map(p => (
              <button key={p.id} onClick={() => onOpenPlaylistDetail?.(p.id)} className="aura-dlib__row">
                {p.coverImageUrl
                  ? <img src={p.coverImageUrl} alt="" className="aura-dlib__cover" loading="lazy"/>
                  : <span className="aura-dlib__cover aura-dlib__cover--fallback">
                      {(p.name?.[0] ?? '·').toLowerCase()}
                    </span>}
                <div className="flex-1 min-w-0">
                  <div className="aura-dlib__row-title">{p.name}</div>
                  <MonoLabel className="text-ink-soft mt-1 block" size={9.5}>
                    {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
                  </MonoLabel>
                </div>
              </button>
            ))}
          </div>
        </div>

        <section className="aura-dlib__browse">
          <MonoLabel className="text-ink-faint" size={10}>browse by language</MonoLabel>
          <div className="aura-dlib__lang-row">
            {HOME_LANGS.map(L => (
              <button key={L} onClick={() => onOpenLangHub?.(L)} className="aura-dlib__lang">
                {L}
              </button>
            ))}
          </div>
        </section>
        </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { useAuth } from '../../lib/auth';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getLibrarySummary } from '../../api/library';
import { listLiked } from '../../api/likes';
import { listPlaylists } from '../../api/playlists';
import { cleanTitle } from '../../utils/title';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { SettingsPanel } from '../../components/SettingsPanel';
import { toast } from '../../lib/toast';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import '../PlaylistsScreen.css';
import './DesktopLibrary.css';

const HOME_LANGS = ['tamil', 'english', 'hindi', 'malayalam', 'kannada'];

// Which shelf is open survives player round-trips (sessionStorage, not local —
// fresh visits land on the calm all-closed composition). This also keeps
// useScrollMemory honest: the saved offset was recorded with a shelf open, so
// restoring the shelf in the same commit keeps scrollHeight tall enough.
const SHELF_KEY = 'aura.libraryShelf';

// One glass shelf: the title is always visible; the body expands in place via
// the grid-rows 0fr→1fr trick. `peek` is the living preview shown while
// closed (cover fan / counts / dots) — it eases out as the rows fade up.
// The clip layer's delayed visibility:hidden keeps collapsed content out of
// the tab order and the a11y tree without React 18's awkward inert handling.
function Shelf({ id, title, peek, open, onToggle, children }) {
  return (
    <section className={`aura-dlib__shelf ${open ? 'is-open' : ''}`}>
      <button type="button" className="aura-dlib__shelf-head"
        aria-expanded={open} aria-controls={`shelf-${id}`} onClick={onToggle}>
        <span className="aura-dlib__shelf-title">{title}</span>
        <span className="aura-dlib__peek">{peek}</span>
        <span className="aura-dlib__shelf-plus" aria-hidden="true">+</span>
      </button>
      <div id={`shelf-${id}`} role="region" aria-label={title} className="aura-dlib__shelf-body">
        <div className="aura-dlib__shelf-clip">
          <div className="aura-dlib__shelf-inner">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function DesktopLibrary({ onPlaySequence, onPickLive, onPlayNext, onAddToQueue, onOpenLiked, onOpenPlaylists, onOpenPlaylistDetail, onOpenLangHub, onOpenJournal, onOpenDna, t, setTweak }) {
  const { user } = useAuth();
  const [summary, setSummary]     = useState(null);
  const [liked, setLiked]         = useState(null);
  const [playlists, setPlaylists] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [menu, setMenu]           = useState(null);
  const [openShelf, setOpenShelf] = useState(() => {
    try { return sessionStorage.getItem(SHELF_KEY); } catch { return null; }
  });

  const toggleShelf = (id) => {
    const next = openShelf === id ? null : id;
    setOpenShelf(next);
    try {
      if (next) sessionStorage.setItem(SHELF_KEY, next);
      else sessionStorage.removeItem(SHELF_KEY);
    } catch { /* sessionStorage disabled */ }
  };

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
  const scrollRef = useScrollMemory('library', { ready: !loading });

  const playNow    = (t) => { setMenu(null); onPickLive?.(t); };
  const playNext   = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addQueue   = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList  = (t) => { setMenu(null); openAddToPlaylist(t); };

  const profileName  = (user?.name && user.name.trim()) || user?.email || 'you';
  const profileEmail = user?.email || '';
  const initial      = (profileName[0] || '?').toUpperCase();

  const emptyPeek = <span className="aura-dlib__peek-empty">nothing yet</span>;

  return (
    <div className="aura-dlib" onClick={() => setMenu(null)}>
      <div ref={scrollRef} className="aura-dlib__scroll">
        {loading && <AuraLoader label="Loading library"/>}
        {!loading && !hasAnyData && summary && (
          <div className="aura-dlib__empty">
            Nothing played yet. Your library fills as you listen.
          </div>
        )}

        {!loading && (
        <div className="aura-dlib__shelves">
          {/* Your year — pinned open at the top: the listener's data is just
              there on arrival, no action needed. */}
          <section className="aura-dlib__shelf aura-dlib__shelf--static aura-dlib__shelf--pinned">
            <div className="aura-dlib__pinned-head">
              <span className="aura-dlib__shelf-title">your year</span>
            </div>
            {summary && (
              <div className="aura-dlib__stats">
                <MonoLabel className="text-ink-faint" size={11}>{summary.tracksPlayed ?? 0} tracks played &nbsp; &nbsp; for</MonoLabel>
                <MonoLabel className="text-ink-faint" size={11}>{summary.minutesListened ?? 0} minutes</MonoLabel>
              </div>
            )}
            {(onOpenJournal || onOpenDna) && (
              <div className="aura-dlib__study-links">
                {onOpenJournal && <button type="button" onClick={onOpenJournal} className="aura-dlib__study-link">your journal →</button>}
                {onOpenDna && <button type="button" onClick={onOpenDna} className="aura-dlib__study-link">sonic dna →</button>}
              </div>
            )}
          </section>

          <Shelf id="liked" title="liked songs"
            open={openShelf === 'liked'} onToggle={() => toggleShelf('liked')}
            peek={liked?.length > 0 ? (
              <>
                <span className="aura-dlib__fan" aria-hidden="true">
                  {liked.slice(0, 3).map(t => <AlbumArt key={t.id} track={t} size={26} radius={5}/>)}
                </span>
                <MonoLabel className="text-ink-faint" size={10}>{liked.length}</MonoLabel>
              </>
            ) : emptyPeek}>
            {(!liked || liked.length === 0) && (
              <div className="aura-dlib__empty-row">No liked songs yet. Tap the heart on any track.</div>
            )}
            {liked?.length > 0 && liked.slice(0, 4).map((t, i) => (
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
            {onOpenLiked && liked?.length > 0 && (
              <div className="aura-dlib__shelf-foot">
                <button onClick={onOpenLiked} className="aura-dlib__see-all">SEE ALL →</button>
              </div>
            )}
          </Shelf>

          <Shelf id="playlists" title="playlists"
            open={openShelf === 'playlists'} onToggle={() => toggleShelf('playlists')}
            peek={playlists?.length > 0 ? (
              <>
                <span className="aura-dlib__fan" aria-hidden="true">
                  {playlists.slice(0, 3).map(p => (
                    p.coverImageUrl
                      ? <img key={p.id} src={p.coverImageUrl} alt="" className="aura-dlib__peek-cover" loading="lazy"/>
                      : <span key={p.id} className="aura-dlib__cover--fallback aura-dlib__peek-cover">
                          {(p.name?.[0] ?? '·').toLowerCase()}
                        </span>
                  ))}
                </span>
                <MonoLabel className="text-ink-faint" size={10}>{playlists.length}</MonoLabel>
              </>
            ) : emptyPeek}>
            {(!playlists || playlists.length === 0) && (
              <div className="aura-dlib__empty-row">No playlists yet. Create one from any song’s menu.</div>
            )}
            {playlists?.length > 0 && playlists.slice(0, 10).map(p => (
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
            {onOpenPlaylists && playlists?.length > 0 && (
              <div className="aura-dlib__shelf-foot">
                <button onClick={onOpenPlaylists} className="aura-dlib__see-all">SEE ALL →</button>
              </div>
            )}
          </Shelf>

          <Shelf id="languages" title="languages"
            open={openShelf === 'languages'} onToggle={() => toggleShelf('languages')}
            peek={
              <span className="aura-dlib__fan" aria-hidden="true">
                {HOME_LANGS.map(L => <span key={L} className="aura-dlib__peek-dot">{L[0]}</span>)}
              </span>
            }>
            <div className="aura-dlib__lang-row">
              {HOME_LANGS.map(L => (
                <button key={L} onClick={() => onOpenLangHub?.(L)} className="aura-dlib__lang">
                  {L}
                </button>
              ))}
            </div>
          </Shelf>

          {/* Settings — expands in place like every other shelf. The cog is
              the peek (a toothed cog, not radiating spokes — spokes read as a
              sun and get mistaken for the theme toggle). */}
          <Shelf id="settings" title="settings"
            open={openShelf === 'settings'} onToggle={() => toggleShelf('settings')}
            peek={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="aura-dlib__peek-cog">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              </svg>
            }>
            <SettingsPanel t={t} setTweak={setTweak}/>
          </Shelf>
        </div>
        )}
      </div>

      {/* Identity chip — you sign the corner of your own screen. Floats
          bottom-left, level with the quick-access dial (right:16, bottom:96
          on compact). Display-only. */}
      <div className="aura-dlib__id-chip" aria-hidden="true">
        <span className="aura-dlib__avatar">{initial}</span>
        <div className="aura-dlib__who">
          <div className="aura-dlib__who-name">{profileName}</div>
          {profileEmail && <div className="aura-dlib__who-email">{profileEmail}</div>}
        </div>
      </div>
    </div>
  );
}

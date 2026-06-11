import { useEffect, useMemo, useRef, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { searchCatalog } from '../../api/catalog';
import { useDebounced } from '../../hooks/useDebounced';
import { pushRecentSearch } from '../../hooks/useRecentSearches';
import { cleanTitle } from '../../utils/title';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { subscribeSearchFocus, requestSearchFocus } from '../../lib/searchFocus';
import { useSearchQuery, setSearchQuery } from '../../lib/searchQuery';
import { getSearchResult, setSearchResult, getSearchLang, setSearchLang } from '../../lib/searchCache';
import { getSeedSignals } from '../../lib/onboarding';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { toast } from '../../lib/toast';
import { SearchSidebar } from './SearchSidebar';
import '../PlaylistsScreen.css';
import './DesktopSearch.css';

const LANGS = ['all', 'tamil', 'english', 'hindi', 'malayalam', 'kannada'];
const EMPTY = { key: '', top: null, songs: [], artists: [], albums: [], playlists: [], userPlaylists: [], error: null };

// A cover-tile (album / movie / playlist / artist — `round` for artist avatars).
function EntityTile({ image, name, sub, badge, round = false, onClick }) {
  const shape = round ? ' aura-dse__cover--round' : '';
  return (
    <button onClick={onClick} className="aura-dse__playlist">
      <span className="aura-dse__cover-wrap">
        {image
          ? <img src={image} alt="" loading="lazy" className={`aura-dse__cover${shape}`}/>
          : <span className={`aura-dse__cover aura-dse__cover--fallback${shape}`}>{name?.[0]?.toUpperCase() ?? '·'}</span>}
        {badge && <span className="aura-dse__badge">{badge}</span>}
      </span>
      <span className="block min-w-0">
        <span className="aura-dse__title-text block">{name}</span>
        {sub && <MonoLabel className="text-ink-soft mt-1 block truncate" size={9.5}>{sub}</MonoLabel>}
      </span>
    </button>
  );
}

// `headerless` (mobile): the top bar IS the search input, so hide this screen's
// own input + intro labels and keep only the language filters + results below.
export function DesktopSearch({
  djName, onClose, onPickLive, onPlayNext, onAddToQueue,
  onOpenPlaylist, onOpenArtist, onOpenAlbum, onOpenCatalogPlaylist, headerless = false,
}) {
  const { query: q, setQuery: setQ } = useSearchQuery();
  const [lang, setLang] = useState(getSearchLang());
  const [hit, setHit] = useState(EMPTY);   // last fetched result; set only in the async callback
  const [menu, setMenu] = useState(null);
  const debouncedQ = useDebounced(q, 300);
  const wantKey = `${debouncedQ}|${lang}`;
  const inputRef = useRef(null);
  // The user's languages, priority-ordered — drives my-languages-first ranking.
  const prefLangs = useMemo(() => getSeedSignals().languages ?? [], []);
  // Display = the just-fetched hit if current, else the cached result for this
  // key (so returning from an album/movie shows instantly — no flash, no
  // re-fetch). Derived at render time to avoid setState-in-effect.
  const cached = getSearchResult(wantKey);
  const view = hit.key === wantKey ? hit : (cached ?? EMPTY);

  useEffect(() => {
    if (headerless) return undefined;   // no own input to focus — top bar owns it
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [headerless]);
  useEffect(() => {
    // On mobile the top bar owns the input + the focus bus; subscribing here too
    // would let this (input-less) screen consume the buffered focus and swallow
    // the keyboard. Desktop keeps the subscription for the `/` shortcut.
    if (headerless) return undefined;
    return subscribeSearchFocus(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [headerless]);
  const trimmed = debouncedQ.trim();
  const status = !trimmed ? 'idle'
    : view.error ? 'error'
    : view.key === wantKey ? 'ok'
    : 'loading';

  // Remember scroll position per query+lang so returning from an album/movie
  // lands where you left off (results render instantly from searchCache, so the
  // height is correct the moment status is 'ok').
  const scrollRef = useScrollMemory(`search:${wantKey}`, { ready: status === 'ok' });

  const pickLang = (L) => { setLang(L); setSearchLang(L); };

  useEffect(() => {
    if (!trimmed) return;
    if (getSearchResult(wantKey)) return;   // already cached — `view` shows it, skip the fetch
    const ctl = new AbortController();
    searchCatalog(debouncedQ, {
      lang: lang === 'all' ? undefined : lang,
      langs: prefLangs,
      limit: 12,
      signal: ctl.signal,
    })
      .then(d => {
        const next = { key: wantKey, ...d, error: null };
        setHit(next);
        setSearchResult(wantKey, next);
        // Remember the query once something actually matched.
        if (d.songs.length || d.albums.length || d.playlists.length || d.userPlaylists.length) {
          pushRecentSearch(trimmed);
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ ...EMPTY, key: wantKey, error: err.message });
      });
    return () => ctl.abort();
  }, [debouncedQ, lang, wantKey, trimmed, prefLangs]);

  const playNow      = (t) => { setMenu(null); onPickLive?.(t); };
  const playNextItem = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addToQueue   = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList    = (t) => { setMenu(null); openAddToPlaylist(t); };

  // The best match routes to the right page by entity type.
  const openTop = () => {
    const t = view.top;
    if (!t) return;
    if (t.type === 'artist')        onOpenArtist?.({ id: t.id });
    else if (t.type === 'album')    onOpenAlbum?.(t.id);
    else if (t.type === 'playlist') onOpenCatalogPlaylist?.(t.id);
  };
  const top = view.top;
  const topLabel = !top ? '' : top.type === 'album'
    ? (top.isMovie ? 'Movie' : 'Album')
    : top.type.charAt(0).toUpperCase() + top.type.slice(1);
  const showHero = top && top.type !== 'song';       // songs lead for a song query
  const albumFirst = top?.type === 'album';          // a movie/album query → albums first

  const nothing = !top && !view.songs.length && !view.artists.length && !view.albums.length && !view.playlists.length && !view.userPlaylists.length;

  const heroSection = showHero && (
    <section>
      <div className="aura-dse__section-title">Top result</div>
      <button onClick={openTop} className="aura-dse__top">
        {top.image
          ? <img src={top.image} alt="" loading="lazy" className={`aura-dse__top-cover ${top.type === 'artist' ? 'aura-dse__cover--round' : ''}`}/>
          : <span className={`aura-dse__top-cover aura-dse__cover--fallback ${top.type === 'artist' ? 'aura-dse__cover--round' : ''}`}>{top.name?.[0]?.toUpperCase() ?? '·'}</span>}
        <span className="aura-dse__top-meta">
          <span className="aura-dse__top-name">{top.name}</span>
          <MonoLabel className="text-ink-faint block" size={10}>{topLabel}</MonoLabel>
        </span>
      </button>
    </section>
  );

  const songsSection = view.songs.length > 0 && (
    <section>
      <div className="aura-dse__section-title">Songs</div>
      <div className="aura-dse__results">
        {view.songs.map(t => (
          <div key={t.id} className="aura-dse__result-wrap" onContextMenu={ctxOpen(t)}>
            <button onClick={(e) => onPickLive?.(t, e.currentTarget)} className="aura-dse__result">
              <AlbumArt track={t} radius={6} style={{ width: '100%', height: 'auto', aspectRatio: 1 }}/>
              <div>
                <div className="aura-dse__title-text">{cleanTitle(t.title)}</div>
                <MonoLabel className="text-ink-soft mt-1 block truncate" size={9.5}>{t.artist ?? ''}</MonoLabel>
              </div>
            </button>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setMenu(m => m?.id === t.id ? null : { id: t.id, el }); }}
              aria-label="more" className="aura-dse__more">
              <svg width="4" height="16" viewBox="0 0 4 16">
                <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
              </svg>
            </button>
            {menu?.id === t.id && (
              <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={166}>
                <button onClick={() => playNow(t)}      className="aura-pl-menu-item">Play song</button>
                <button onClick={() => playNextItem(t)} className="aura-pl-menu-item">Play next</button>
                <button onClick={() => addToQueue(t)}   className="aura-pl-menu-item">Add to queue</button>
                <button onClick={() => addToList(t)}    className="aura-pl-menu-item">Add to playlist</button>
              </AnchoredMenu>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  // Only sent by the server when the top result isn't already this artist and
  // the names genuinely match the query — so the row stays relevant.
  const artistsSection = view.artists.length > 0 && (
    <section>
      <div className="aura-dse__section-title">Artists</div>
      <div className="aura-dse__playlists">
        {view.artists.map(a => (
          <EntityTile key={a.id} image={a.image} name={a.name} sub="Artist" round
            onClick={() => onOpenArtist?.({ id: a.id })}/>
        ))}
      </div>
    </section>
  );

  const albumsSection = view.albums.length > 0 && (
    <section>
      <div className="aura-dse__section-title">Albums &amp; movies</div>
      <div className="aura-dse__playlists">
        {view.albums.map(a => (
          <EntityTile key={a.id} image={a.image} name={a.name}
            sub={[a.isMovie ? 'Movie' : 'Album', a.year].filter(Boolean).join(' · ')}
            badge={a.isMovie ? 'Movie' : null}
            onClick={() => onOpenAlbum?.(a.id)}/>
        ))}
      </div>
    </section>
  );

  const playlistsSection = view.playlists.length > 0 && (
    <section>
      <div className="aura-dse__section-title">Playlists</div>
      <div className="aura-dse__playlists">
        {view.playlists.map(p => (
          <EntityTile key={p.id} image={p.image} name={p.name} sub={p.subtitle || 'Playlist'}
            onClick={() => onOpenCatalogPlaylist?.(p.id)}/>
        ))}
      </div>
    </section>
  );

  const yourPlaylistsSection = view.userPlaylists.length > 0 && (
    <section>
      <div className="aura-dse__section-title">Your playlists</div>
      <div className="aura-dse__playlists">
        {view.userPlaylists.map(p => (
          <EntityTile key={p.id} image={p.coverImageUrl} name={p.name}
            sub={`${p.trackCount ?? 0} ${p.trackCount === 1 ? 'track' : 'tracks'}`}
            onClick={() => onOpenPlaylist?.(p.id)}/>
        ))}
      </div>
    </section>
  );

  return (
    <div ref={scrollRef} className={`aura-dse ${headerless ? 'aura-dse--headerless' : ''}`} onClick={() => setMenu(null)}>
      {onClose && !headerless && (
        <button type="button" onClick={() => { setSearchQuery(''); onClose(); }} aria-label="close search" className="aura-dse__close">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      )}
      <div className="aura-dse__header">
        {!headerless && (
          <>
            <MonoLabel className="text-ink-faint" size={10}>Search · Artists · Songs · Albums · Playlists</MonoLabel>
            <div className="aura-dse__input-wrap" onClick={() => inputRef.current?.focus()}>
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search songs, artists, albums, movies"
                className="aura-dse__input" autoFocus type="search"
                autoComplete="off" spellCheck={false}/>
            </div>
            <MonoLabel className="text-ink-faint mt-2.5 block" size={10}>
              {djName} surfaces matches as you type.
            </MonoLabel>
          </>
        )}
        <div className="aura-dse__langs">
          {LANGS.map(L => (
            <button key={L} onClick={() => pickLang(L)}
              className={`aura-dse__lang ${lang === L ? 'aura-dse__lang--on' : ''}`}>
              {L.charAt(0).toUpperCase() + L.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="aura-dse__layout">
        <div className="aura-dse__main">
          {status === 'idle'    && <div className="aura-dse__hint">Your search results will appear here.</div>}
          {status === 'loading' && <AuraLoader label="Searching"/>}
          {status === 'error'   && <div className="aura-dse__hint">Search failed — {view.error}</div>}

          {status === 'ok' && (
            <div className="aura-dse__sections">
              {nothing && <div className="aura-dse__hint">Nothing matched &ldquo;{debouncedQ}&rdquo;.</div>}
              {heroSection}
              {albumFirst
                ? <>{albumsSection}{songsSection}</>
                : <>{songsSection}{artistsSection}{albumsSection}</>}
              {albumFirst && artistsSection}
              {playlistsSection}
              {yourPlaylistsSection}
            </div>
          )}
        </div>
        <SearchSidebar lang={lang} onPick={(picked) => {
          setQ(picked);
          // Headerless (mobile): the input lives in the top bar — refocus it via
          // the bus so the keyboard reopens (inputRef here is null).
          if (headerless) requestSearchFocus(); else inputRef.current?.focus();
        }}/>
      </div>
    </div>
  );
}

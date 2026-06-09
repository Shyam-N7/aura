import { useEffect, useRef, useState } from 'react';
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
import { ctxOpen } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { toast } from '../../lib/toast';
import { SearchSidebar } from './SearchSidebar';
import '../PlaylistsScreen.css';
import './DesktopSearch.css';

const LANGS = ['all', 'tamil', 'english', 'hindi', 'malayalam', 'kannada'];

// `headerless` (mobile): the top bar IS the search input, so hide this screen's
// own input + intro labels and keep only the language filters + results below.
export function DesktopSearch({ djName, onClose, onPickLive, onPlayNext, onAddToQueue, onOpenPlaylist, headerless = false }) {
  const { query: q, setQuery: setQ } = useSearchQuery();
  const [lang, setLang] = useState('all');
  const [hit, setHit] = useState({ key: '', results: [], playlists: [], error: null });
  const [menu, setMenu] = useState(null);
  const debouncedQ = useDebounced(q, 300);
  const wantKey = `${debouncedQ}|${lang}`;
  const inputRef = useRef(null);

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
    : hit.key === wantKey ? (hit.error ? 'error' : 'ok')
    : 'loading';

  useEffect(() => {
    if (!trimmed) return;
    const ctl = new AbortController();
    searchCatalog(debouncedQ, {
      lang: lang === 'all' ? undefined : lang,
      limit: 12,
      signal: ctl.signal,
    })
      .then(({ results, playlists }) => {
        setHit({ key: wantKey, results, playlists, error: null });
        // Remember the query once we actually got results back — avoids
        // noisy recents from mid-typing partial queries that erred out.
        if ((results?.length ?? 0) > 0 || (playlists?.length ?? 0) > 0) {
          pushRecentSearch(trimmed);
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ key: wantKey, results: [], playlists: [], error: err.message });
      });
    return () => ctl.abort();
  }, [debouncedQ, lang, wantKey, trimmed]);

  const playNow      = (t) => { setMenu(null); onPickLive?.(t); };
  const playNextItem = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addToQueue   = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList    = (t) => { setMenu(null); openAddToPlaylist(t); };

  return (
    <div className={`aura-dse ${headerless ? 'aura-dse--headerless' : ''}`} onClick={() => setMenu(null)}>
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
            <MonoLabel className="text-ink-faint" size={10}>Search · Catalog + Your playlists</MonoLabel>
            <div className="aura-dse__input-wrap" onClick={() => inputRef.current?.focus()}>
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search songs, artists, or moods"
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
            <button key={L} onClick={() => setLang(L)}
              className={`aura-dse__lang ${lang === L ? 'aura-dse__lang--on' : ''}`}>
              {L.charAt(0).toUpperCase() + L.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="aura-dse__layout">
        <div className="aura-dse__main">
          {status === 'idle' && (
            <div className="aura-dse__hint">
              Type a title, artist, mood, or fragment.
            </div>
          )}
          {status === 'loading' && (
            <AuraLoader label="Searching"/>
          )}
          {status === 'error' && (
            <div className="aura-dse__hint">
              Search failed — {hit.error}
            </div>
          )}

          {status === 'ok' && (
            <div className="aura-dse__sections">
          {hit.playlists.length > 0 && (
            <section>
              <div className="aura-dse__section-title">Your playlists</div>
              <div className="aura-dse__playlists">
                {hit.playlists.map(p => (
                  <button key={p.id} onClick={() => onOpenPlaylist?.(p.id)} className="aura-dse__playlist">
                    {p.coverImageUrl
                      ? <img src={p.coverImageUrl} alt="" className="aura-dse__cover" loading="lazy"/>
                      : <span className="aura-dse__cover aura-dse__cover--fallback">
                          {p.name?.[0]?.toUpperCase() ?? '·'}
                        </span>}
                    <div>
                      <div className="aura-dse__title-text">{p.name}</div>
                      <MonoLabel className="text-ink-soft mt-1 block" size={9.5}>
                        {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'} · Playlist
                      </MonoLabel>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {hit.results.length > 0 && (
            <section>
              <div className="aura-dse__section-title">Tracks</div>
              <div className="aura-dse__results">
                {hit.results.map(t => (
                  <div key={t.id} className="aura-dse__result-wrap" onContextMenu={ctxOpen(t)}>
                    <button onClick={(e) => onPickLive?.(t, e.currentTarget)}
                      className="aura-dse__result">
                      <AlbumArt track={t} radius={6}
                        style={{ width: '100%', height: 'auto', aspectRatio: 1 }}/>
                      <div>
                        <div className="aura-dse__title-text">{cleanTitle(t.title)}</div>
                        <MonoLabel className="text-ink-soft mt-1 block truncate" size={9.5}>
                          {t.artist ?? ''}
                        </MonoLabel>
                      </div>
                    </button>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setMenu(m => m?.id === t.id ? null : { id: t.id, el }); }}
                      aria-label="more"
                      className="aura-dse__more">
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
          )}

              {hit.results.length === 0 && hit.playlists.length === 0 && (
                <div className="aura-dse__hint">
                  Nothing matched &ldquo;{debouncedQ}&rdquo;.
                </div>
              )}
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

import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getDiscoverHome } from '../../api/discover';
import { cleanTitle } from '../../utils/title';
import { CrumbBack } from './CrumbBack';
import { SectionHeader } from './SectionHeader';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import './DesktopLanguageHub.css';

export function DesktopLanguageHub({ lang, onClose, onPickLive, onOpenCatalogPlaylist }) {
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';
  const scrollRef = useScrollMemory(`lang:${lang}`, { ready: status === 'ok' });

  useEffect(() => {
    const ctl = new AbortController();
    getDiscoverHome({ lang, signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [lang]);

  const trending  = hit.data?.trending ?? [];
  const playlists = hit.data?.popularPlaylists ?? [];
  const topHits   = hit.data?.topHits ?? [];
  const classics  = hit.data?.classics ?? [];
  const movies    = hit.data?.movieSongs ?? [];
  const anyContent = trending.length || playlists.length || topHits.length || classics.length || movies.length;

  const langTitle = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : '';

  return (
    <div ref={scrollRef} className="aura-dlh">
      <div className="aura-dlh__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
          <MonoLabel className="text-ink-faint" size={10}>browse · {lang}</MonoLabel>
        </div>
        <h1 className="aura-dlh__hero">
          <em>{lang}.</em>
        </h1>
      </div>

      <div className="aura-dlh__scroll">
        {status === 'loading' && (
          <AuraLoader label={`Loading ${langTitle}`}/>
        )}
        {status === 'error' && (
          <div className="aura-dlh__error">
            Couldn’t load — {hit.error}
          </div>
        )}

        {status === 'ok' && !anyContent && (
          <div className="aura-dlh__error">
            Nothing here yet for {langTitle}.
          </div>
        )}

        {status === 'ok' && trending.length > 0 && (
          <Shelf title="Trending" sub={`Popular in ${langTitle} right now`}>
            <TrackRow tracks={trending} onPickLive={onPickLive}/>
          </Shelf>
        )}
        {status === 'ok' && topHits.length > 0 && (
          <Shelf title="Top hits" sub={`What’s playing in ${langTitle}`}>
            <TrackRow tracks={topHits} onPickLive={onPickLive}/>
          </Shelf>
        )}
        {status === 'ok' && playlists.length > 0 && (
          <Shelf title="Popular playlists" sub={`Curated for ${langTitle}`}>
            <div className="aura-dlh__playlists">
              {playlists.slice(0, 8).map(p => (
                <button key={p.id} onClick={() => onOpenCatalogPlaylist?.(p.id)} className="aura-dlh__playlist">
                  {p.coverImageUrl
                    ? <img src={p.coverImageUrl} alt="" loading="lazy" className="aura-dlh__pl-cover"/>
                    : <span className="aura-dlh__pl-cover aura-dlh__pl-cover--fallback">
                        {(p.name?.[0] ?? '·').toLowerCase()}
                      </span>}
                  <div>
                    <div className="aura-dlh__pl-name">{p.name}</div>
                    {p.subtitle && (
                      <MonoLabel className="text-ink-soft mt-1 block truncate" size={9}>
                        {p.subtitle.toLowerCase()}
                      </MonoLabel>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </Shelf>
        )}
        {status === 'ok' && classics.length > 0 && (
          <Shelf title="Classics" sub={`Timeless ${langTitle} songs`}>
            <TrackRow tracks={classics} onPickLive={onPickLive}/>
          </Shelf>
        )}
        {status === 'ok' && movies.length > 0 && (
          <Shelf title="From the movies" sub={`Recent ${langTitle} film soundtracks`}>
            <TrackRow tracks={movies} onPickLive={onPickLive}/>
          </Shelf>
        )}

        {status === 'ok' && anyContent && (
          <div className="aura-dlh__footer">
            <MonoLabel className="text-ink-faint" size={9}>— end of {lang} —</MonoLabel>
          </div>
        )}
      </div>
    </div>
  );
}

function Shelf({ title, sub, children }) {
  return (
    <>
      <SectionHeader title={title} sub={sub} large/>
      {children}
    </>
  );
}

function TrackRow({ tracks, onPickLive }) {
  return (
    <div className="aura-dlh__tracks">
      {tracks.slice(0, 8).map(t => (
        <button key={t.id} onClick={(e) => onPickLive?.(t, e.currentTarget)} className="aura-dlh__track">
          <AlbumArt track={t} radius={6} style={{ width: '100%', height: 'auto', aspectRatio: 1 }}/>
          <div>
            <div className="aura-dlh__t-title">{cleanTitle(t.title)}</div>
            <MonoLabel className="text-ink-soft mt-1 block truncate" size={9.5}>
              {(t.artist ?? '').toLowerCase()}
            </MonoLabel>
          </div>
        </button>
      ))}
    </div>
  );
}

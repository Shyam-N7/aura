import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getAlbum } from '../../api/catalog';
import { fmtTime, fmtRuntime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { openTrackMenu } from '../../lib/trackContextMenu';
import { CrumbBack } from './CrumbBack';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { BackToTop } from '../../components/BackToTop';
import { setMeta } from '../../lib/meta';
import './DesktopPlaylistDetail.css'; // reuse the .aura-dpd detail layout

// Album / movie detail. Indian-cinema soundtracks are albums with isMovie; the
// eyebrow names it a movie or album. Same layout as the catalog playlist detail.
export function DesktopAlbumDetail({ albumId, onClose, onPlaySequence }) {
  const [hit, setHit] = useState({ data: null, error: null });
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

  const scrollRef = useScrollMemory(`album:${albumId}`, { ready: status === 'ok' });
  const tracks = hit.data?.tracks ?? [];
  const kind = hit.data?.isMovie ? 'movie' : 'album';

  // Name-based tab title + JSON-LD once the album loads. No cleanup — the
  // App-level screen-title effect re-asserts on every navigation.
  const albumName = hit.data?.name;
  useEffect(() => {
    if (!albumName) return;
    setMeta({
      title: `${albumName} · AURA`,
      jsonLd: { '@type': 'MusicAlbum', name: albumName, url: window.location.href },
    });
  }, [albumName]);
  const playAll = () => {
    if (tracks.length) onPlaySequence(tracks, 0, (hit.data?.name ?? `this ${kind}`).toLowerCase());
  };

  // Multiple artists arrive as a comma-joined string — show only the main one.
  const mainArtist = (hit.data?.artist ?? '').split(',')[0].trim();

  return (
    <div ref={scrollRef} className="aura-dpd">
      <div className="aura-dpd__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
        </div>

        {status === 'loading' && <AuraLoader label={`Loading ${kind}`}/>}
        {status === 'error' && <div className="aura-dpd__error">Couldn’t load — {hit.error}</div>}
        {status === 'ok' && (
          <>
            <div className="aura-dpd__kind">{kind}</div>
            <h1 className="aura-dpd__hero">{hit.data.name}</h1>
            {mainArtist && <div className="aura-dpd__by">by {mainArtist}</div>}
            {tracks.length > 0 && (
              <div className="mt-6">
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
            <div className="aura-dpd__count">
              <span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>-
              <span>{fmtRuntime(tracks.reduce((s, t) => s + (t.durationSec || 0), 0))}</span>
            </div>
            {tracks.map((t, i) => (
              <div key={t.id} className="aura-dpd__row">
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
                <button type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    openTrackMenu({ track: t, x: r.right, y: r.bottom });
                  }}
                  aria-label="more" className="aura-dpd__more">
                  <svg width="4" height="16" viewBox="0 0 4 16">
                    <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                    <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                    <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <BackToTop scrollRef={scrollRef}/>
    </div>
  );
}

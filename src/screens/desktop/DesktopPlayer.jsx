import { useEffect, useMemo, useRef, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { MorphingAlbumArt } from '../../components/album/MorphingAlbumArt';
import { MoreLikeThisCarousel } from '../../components/player/MoreLikeThisCarousel';
import { useRelated } from '../../components/player/useRelated';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getLyrics } from '../../api/lyrics';
import { cleanTitle, cleanLyric } from '../../utils/title';
import './DesktopPlayer.css';

// Player view — lyrics-focused, two-column grid at tablet-portrait and up: art +
// meta on the left, full synced lyrics on the right. Transport lives in the rail.
// Phone widths (<600px) render the dedicated MobilePlayer instead (see App.jsx).
export function DesktopPlayer({
  track, audioTime, player, mood, onBack, onSeek,
  showRelated = false, onPickLive, onPlayNext, onAddToQueue,
}) {
  const [hit, setHit] = useState({ trackId: null, data: null, error: null });
  const [view, setView] = useState('en');
  // Related songs — fetched once and shown in the left-column carousel.
  const related = useRelated(track.id, track.language);
  const status = hit.trackId === track.id
    ? (hit.error ? 'error' : hit.data ? 'ok' : 'loading')
    : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getLyrics(track.id, { signal: ctl.signal })
      .then(data => setHit({ trackId: track.id, data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ trackId: track.id, data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [track.id]);

  const hasEnglish = !!hit.data?.has_english;
  const effectiveView = hasEnglish ? view : 'orig';

  return (
    <div className="aura-dp">
      <div className="aura-dp__topbar">
        <button onClick={onBack} aria-label="back" className="aura-dp__back">
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M8 1 L3 5 L8 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span className="aura-dp__back-text">Back</span>
        </button>
        <div className="aura-dp__topbar-meta">
          <MonoLabel className="text-ink-faint" size={9}>Now playing</MonoLabel>
          <span className="aura-dp__mood">{mood}</span>
        </div>
      </div>

      <div className="aura-dp__grid">
        <div className="aura-dp__left">
          <div id="player-art">
            <MorphingAlbumArt track={track} size={360} radius={6}/>
          </div>
          <div key={track.id} className="aura-dp__meta aura-track-text">
            <MonoLabel className="text-ink-faint" size={9}>
              {track.album ?? ''}
            </MonoLabel>
            <div className="aura-dp__title">{cleanTitle(track.title)}</div>
            <div className="aura-dp__artist">{track.artist}</div>
          </div>
          {hasEnglish && (
            <div className="aura-dp__lang-toggle">
              <button onClick={() => setView('en')}
                className={`aura-dp__pill ${effectiveView === 'en' ? 'aura-dp__pill--on' : ''}`}>
                English
              </button>
              <button onClick={() => setView('orig')}
                className={`aura-dp__pill ${effectiveView === 'orig' ? 'aura-dp__pill--on' : ''}`}>
                {track.language || 'Original'}
              </button>
            </div>
          )}
          {showRelated && (
            <div className="aura-mlt-host aura-mlt-host--left">
              <MoreLikeThisCarousel
                status={related.status} tracks={related.tracks} error={related.error}
                onPlay={onPickLive} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue}/>
            </div>
          )}
        </div>

        <div className="aura-dp__right">
          <MonoLabel className="text-ink-faint" size={9}>
            Lyrics{status === 'ok' && hit.data?.synced ? ' · Syncing' : status === 'ok' ? ' · Plain' : ''}
          </MonoLabel>

          {status === 'loading' && (
            <div className="mt-7">
              <AuraLoader label="Loading lyrics"/>
            </div>
          )}

          {status === 'error' && (
            <div className="aura-dp__lyrics-message">
              Couldn’t fetch lyrics — {hit.error}
            </div>
          )}

          {status === 'ok' && !hit.data.available && (
            <div className="aura-dp__lyrics-message aura-dp__lyrics-message--lg">
              Lyrics aren’t available for this track.
            </div>
          )}

          {status === 'ok' && hit.data.available && hit.data.synced && (
            <SyncedLyrics lines={hit.data.lines} view={effectiveView}
              audioTime={audioTime}
              onSeekToTime={(sec) => { const d = player.getDurationSec(); if (d > 0) onSeek(sec / d); }}/>
          )}

          {status === 'ok' && hit.data.available && !hit.data.synced && (
            <div className="mt-7">
              <MonoLabel className="text-ink-faint block mb-3" size={9}>
                Synced lyrics aren’t available — showing plain text.
              </MonoLabel>
              <div className="font-serif text-[22px] leading-[1.5] text-ink whitespace-pre-wrap text-pretty max-w-[680px]">
                {cleanLyric(effectiveView === 'en' && hit.data.plain_en ? hit.data.plain_en : hit.data.plain)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SyncedLyrics({ lines, view, audioTime, onSeekToTime }) {
  const seconds = audioTime ?? 0;

  const activeIdx = useMemo(() => {
    let last = -1;
    lines.forEach((l, i) => { if (l.t <= seconds) last = i; });
    return last;
  }, [seconds, lines]);

  const activeRef = useRef(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIdx]);

  const lineFor = (l) => cleanLyric((view === 'en' && l.line_en) ? l.line_en : l.line);

  const seekTo = (l) => {
    onSeekToTime?.(l.t);
  };

  return (
    <div className="aura-dp__lyrics-scroll mt-7">
      {lines.filter(l => l.line).map(l => {
        const realIdx = lines.indexOf(l);
        const isActive = realIdx === activeIdx;
        const isPast = realIdx < activeIdx;
        return (
          <div key={realIdx}
            ref={isActive ? activeRef : undefined}
            role="button"
            tabIndex={0}
            onClick={() => seekTo(l)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seekTo(l); } }}
            className={`aura-dp__line ${isActive ? 'aura-dp__line--active' : isPast ? 'aura-dp__line--past' : ''}`}>
            {lineFor(l)}
          </div>
        );
      })}
    </div>
  );
}


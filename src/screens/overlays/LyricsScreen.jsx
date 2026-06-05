import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { HeartButton } from '../../components/primitives';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getLyrics } from '../../api/lyrics';
import { cleanLyric, cleanTitle } from '../../utils/title';
import { useCinematicIdle } from '../../hooks/useCinematicIdle';
import './LyricsScreen.css';

export function LyricsScreen({ track, audioTime, playing, ended = false, onClose, onSeekToTime, closing = false }) {
  const panelRef = useRef(null);
  const cinematic = useCinematicIdle(panelRef);
  const [hit, setHit] = useState({ trackId: null, data: null, error: null });
  const [view, setView] = useState('en');  // 'en' = romanized, 'orig' = original script
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
  // If the server didn't produce a romanization (already-Latin track), keep
  // the toggle hidden and pin view to 'orig'.
  const effectiveView = hasEnglish ? view : 'orig';

  return (
    <>
      <div className={`aura-lyrics-backdrop ${closing ? 'aura-lyrics-backdrop--out' : 'aura-lyrics-backdrop--in'}`} onClick={onClose}/>
      <div ref={panelRef} className={`aura-lyrics-panel ${cinematic ? 'aura-lyrics-panel--cinematic' : ''} ${closing ? 'aura-lyrics-panel--out' : 'aura-lyrics-panel--in'}`}>
      {track.coverImageUrl && (
        <div className="aura-lyrics-art-tint"
             style={{ backgroundImage: `url("${track.coverImageUrl}")` }}
             aria-hidden="true"/>
      )}
      <div className="aura-lyrics-art-scrim" aria-hidden="true"/>
      <div className="aura-lyrics-stage">
      {cinematic && (
        <div className="aura-lyrics-progress-arc" aria-hidden="true">
          <div className="aura-lyrics-progress-arc__fill"
               style={{ width: ended ? '100%' : (track.durationSec ? `${Math.min(100, ((audioTime ?? 0) / track.durationSec) * 100)}%` : '0%') }}/>
          <span className="aura-lyrics-progress-arc__dot aura-lyrics-progress-arc__dot--start"/>
          <span className={`aura-lyrics-progress-arc__dot aura-lyrics-progress-arc__dot--end${ended ? ' is-ended' : ''}`}/>
        </div>
      )}
      {cinematic && track.title && (
        <div className="aura-lyrics-epigraph" aria-hidden="true">
          {cleanTitle(track.title)}
          <div className="aura-lyrics-epigraph__counter">
            {ended ? 'Song ended' : (track.artist || 'Unknown artist')}
          </div>
        </div>
      )}
      <header className="aura-lyrics-header">
        <div className="aura-lyrics-header__row">
          <div className="aura-lyrics-header__title">{cleanTitle(track.title)}</div>
          <div className="aura-lyrics-header__cluster">
            <HeartButton trackId={track.id} size={20}/>
            <button onClick={onClose} aria-label="Close lyrics" className="aura-lyrics-close">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="aura-lyrics-header__row">
          <div className="aura-lyrics-header__meta">
            {track.artist || 'Unknown artist'}
          </div>
          {hasEnglish && (
            <div className="aura-lyrics-toggle__group" data-on={effectiveView} role="tablist">
              <span className="aura-lyrics-toggle__thumb" aria-hidden="true"/>
              <button
                role="tab"
                aria-selected={effectiveView === 'en'}
                onClick={() => setView('en')}
                className="aura-lyrics-toggle__btn"
              >English</button>
              <button
                role="tab"
                aria-selected={effectiveView === 'orig'}
                onClick={() => setView('orig')}
                className="aura-lyrics-toggle__btn"
              >{track.language || 'Original'}</button>
            </div>
          )}
        </div>
      </header>

      {status === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <AuraLoader label="Loading lyrics"/>
        </div>
      )}

      {status === 'error' && (
        <div className="flex-1 p-7 flex items-start">
          <div className="font-sans text-base text-ink-soft text-pretty">
            Couldn’t fetch lyrics — {hit.error}
          </div>
        </div>
      )}

      {status === 'ok' && !hit.data.available && (
        <div className="flex-1 p-7 flex items-center justify-center">
          <div className="font-sans text-[18px] text-ink-soft text-center text-pretty">
            Lyrics aren’t available<br/>for this track.
          </div>
        </div>
      )}

      {status === 'ok' && hit.data.available && hit.data.synced && (
        <SyncedView
          lines={hit.data.lines}
          view={effectiveView}
          audioTime={audioTime}
          durationSec={track.durationSec}
          onSeekToTime={onSeekToTime}
          playing={playing}
          cinematic={cinematic}
        />
      )}

      {status === 'ok' && hit.data.available && !hit.data.synced && (
        <div className="flex-1 p-7 overflow-auto">
          <div className="font-sans text-[12px] text-ink-faint mb-3">
            Synced lyrics aren&rsquo;t available &mdash; showing plain text.
          </div>
          <div className="font-serif text-[20px] leading-[1.5] text-ink whitespace-pre-wrap text-pretty">
            {cleanLyric(effectiveView === 'en' && hit.data.plain_en ? hit.data.plain_en : hit.data.plain)}
          </div>
        </div>
      )}
      </div>
      </div>
    </>
  );
}

// During a long instrumental break the previously-active line should stop
// reading as "the current line" — we drop its active highlight so the screen
// settles into a neutral past-state instead of leaving a stale line glowing
// while no lyric is actually being sung. Trigger uses the later of GAP_AFTER_SEC
// (absolute floor) and 40% of the gap duration so the line gets its full vocal
// window before the gap mark surfaces.
const MIN_GAP_SEC   = 5;   // total instrumental break must be at least this long
const GAP_AFTER_SEC = 4;   // absolute floor before treating the line as past

// Equalizer-style "music is playing" mark — five vertical bars
// bouncing on asymmetric staggered timings. Reads as a live audio
// meter, not a loading spinner (the previous radar-pulse pattern
// inadvertently looked like a Wi-Fi scanner / loading indicator).
// role="img" + aria-label gives screen readers the semantic that
// the visual already conveys for sighted users.
function LyricsGapMark() {
  return (
    <div className="aura-lyrics-gap-mark" role="img" aria-label="Music playing">
      <span style={{ '--h': '55%',  '--d': '0ms'   }}/>
      <span style={{ '--h': '100%', '--d': '130ms' }}/>
      <span className="aura-lyrics-gap-mark__bar--center"
            style={{ '--h': '80%',  '--d': '290ms' }}/>
      <span style={{ '--h': '100%', '--d': '410ms' }}/>
      <span style={{ '--h': '65%',  '--d': '560ms' }}/>
    </div>
  );
}

function SyncedView({ lines, view, audioTime, durationSec, onSeekToTime, playing, cinematic }) {
  const seconds = audioTime ?? 0;

  const activeIdx = useMemo(() => {
    let last = -1;
    lines.forEach((l, i) => { if (l.t <= seconds) last = i; });
    return last;
  }, [seconds, lines]);

  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];
  const nextLine = lines[activeIdx + 1];
  const activeLine = activeIdx >= 0 ? lines[activeIdx] : null;

  // Three gap windows surface the "music is playing" mark:
  // 1. Intro — before the first sung line, if the intro is long enough.
  // 2. Between — instrumental break between two sung lines.
  // 3. Outro — after the last sung line, until the track ends.
  // All share the same trigger rule: appear later of (GAP_AFTER_SEC, 40%
  // of the gap duration) so a normal vocal line gets its full window
  // before the mark surfaces.
  const introGap = firstLine ? firstLine.t : 0;
  const inIntroGap = activeIdx === -1
    && firstLine
    && introGap >= MIN_GAP_SEC
    && seconds > Math.max(GAP_AFTER_SEC, introGap * 0.4)
    && seconds < firstLine.t;

  const betweenGap = (activeLine && nextLine) ? nextLine.t - activeLine.t : 0;
  const inBetweenGap = activeLine && nextLine
    && betweenGap >= MIN_GAP_SEC
    && seconds > activeLine.t + Math.max(GAP_AFTER_SEC, betweenGap * 0.4)
    && seconds < nextLine.t;

  const outroGap = (lastLine && durationSec) ? durationSec - lastLine.t : 0;
  const inOutroGap = activeIdx === lines.length - 1
    && lastLine
    && outroGap >= MIN_GAP_SEC
    && seconds > lastLine.t + Math.max(GAP_AFTER_SEC, outroGap * 0.4);

  const activeRef = useRef(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIdx]);

  const lineFor = (l) => cleanLyric((view === 'en' && l.line_en) ? l.line_en : l.line);

  const seekTo = (l) => {
    // In cinematic mode, taps are wake-only — they shouldn't move
    // playback to the tapped line. The useCinematicIdle hook resets
    // `cinematic` on pointerdown, but React batches the re-render
    // until after onClick fires — so this closure still sees the
    // pre-wake `cinematic === true` and skips the seek. The NEXT
    // tap (after the wake-render) seeks normally.
    if (cinematic) return;
    onSeekToTime?.(l.t);
  };

  return (
    <div className="flex-1 p-7 flex flex-col gap-[22px] overflow-auto scroll-smooth">
      {/* Intro: mark surfaces before any sung line has happened, during a
          long instrumental intro. */}
      {inIntroGap && playing && <LyricsGapMark/>}
      {lines.filter(l => l.line).map(l => {
        const realIdx = lines.indexOf(l);
        // During an instrumental break (`inBetweenGap`) the previously-
        // active line is no longer being sung — drop its active treatment
        // so the screen reads as "between lyrics" instead of "this line
        // is still current".
        const isActive = realIdx === activeIdx && !inBetweenGap && !inOutroGap;
        const isPast = realIdx < activeIdx
          || (realIdx === activeIdx && (inBetweenGap || inOutroGap));
        const sizeCls = isActive ? 'text-[30px]' : 'text-[22px]';
        const colorCls = isActive ? 'text-ink' : isPast ? 'text-ink-faint' : 'text-ink-soft';
        const cinemaCls = cinematic
          ? (isActive ? 'aura-lyrics-line--cinema-active'
             : isPast ? 'aura-lyrics-line--cinema-past'
             : 'aura-lyrics-line--cinema-upcoming')
          : '';
        const motion = isActive
          ? { transform: 'translateY(0)',    opacity: 1 }
          : isPast
            ? { transform: 'translateY(-2px)', opacity: 0.6 }
            : { transform: 'translateY(6px)',  opacity: 0.85 };
        const showMarkAfter = inBetweenGap && playing && realIdx === activeIdx;
        return (
          <Fragment key={realIdx}>
            <div
              ref={isActive ? activeRef : undefined}
              role="button"
              tabIndex={0}
              onClick={() => seekTo(l)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seekTo(l); } }}
              style={motion}
              className={`aura-lyrics-line font-serif leading-[1.15] tracking-[-0.01em] text-pretty transition-all duration-[380ms] ease-in-out ${sizeCls} ${colorCls} ${cinemaCls}`}>
              {lineFor(l)}
            </div>
            {showMarkAfter && <LyricsGapMark/>}
          </Fragment>
        );
      })}
      {/* Outro: mark surfaces after the last sung line, during the song's
          fade-out / instrumental tail. */}
      {inOutroGap && playing && <LyricsGapMark/>}
    </div>
  );
}

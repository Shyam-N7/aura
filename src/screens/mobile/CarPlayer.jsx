import { useRef } from 'react';
import { MonoLabel, HeartButton } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { ProgressRibbon } from '../../components/player/ProgressRibbon';
import { fmtTime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { tap } from '../../lib/haptics';
import './CarPlayer.css';

// Car Mode driving dashboard — a deliberately stripped, glance-and-go surface for
// when the phone is in a mount and the user is driving. NOT the MobilePlayer (no
// album hero, no EQ, no menus, no swipe gestures): just oversized tap targets — a
// PREV | NEXT split, a full-width PLAY/PAUSE bar, and a full-width push-to-talk mic
// (the hands-free centrepiece). A small art chip gives the song an identity without
// stealing target space; when a spoken "play <x>" is resolving, a center glance
// overlay shows "Playing <x>…". Auto-opens when the user switches to Car Mode; the
// car audio profile (loud + vocal-clarity EQ) is applied separately in App.jsx.
export function CarPlayer({
  track, progress, playing,
  onTogglePlay, onPrev, onNext, onSeek, onBack, djName = 'AURA',
  voiceSupported = false, voiceListening = false, voiceHint = '',
  voiceStatus = { phase: 'idle' },
  onTalkStart, onTalkEnd,
}) {
  const elapsed = fmtTime(progress * track.durationSec);
  const remaining = fmtTime(track.durationSec * (1 - progress));

  // The glance overlay shows for the slow LLM path only (thinking → done/error);
  // 'listening' is conveyed by the mic itself, 'idle' shows nothing.
  const vs = voiceStatus || { phase: 'idle' };
  const glance = (vs.phase === 'thinking' || vs.phase === 'done' || vs.phase === 'error') ? vs.phase : null;
  const liveText =
    vs.phase === 'thinking' ? (vs.text ? `Playing ${vs.text}` : 'Thinking…')
    : vs.phase === 'done'   ? `Now playing ${vs.title}`
    : vs.phase === 'error'  ? vs.text
    : '';
  // Hold the last shown line through the 220ms fade-out (after glance goes null) so
  // the text fades WITH the overlay instead of blanking instantly at fade-start.
  const lastGlanceText = useRef('');
  if (liveText) lastGlanceText.current = liveText;
  const glanceText = glance ? liveText : lastGlanceText.current;

  // Hold-to-talk: press starts the listen window, release (or sliding off the
  // button) ends it. pointer events cover mouse + touch + pen uniformly. A short
  // haptic on press-down confirms the mic armed without looking.
  const talkDown = (e) => { e.preventDefault(); if (voiceSupported) { tap(15); onTalkStart?.(); } };
  const talkUp = () => { if (voiceSupported) onTalkEnd?.(); };
  // Keyboard / switch access: hold Space or Enter to talk (ignore auto-repeat so a
  // held key doesn't restart recognition); releasing — or losing focus — ends it.
  const talkKeyDown = (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); if (voiceSupported) { tap(15); onTalkStart?.(); } }
  };
  const talkKeyUp = (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (voiceSupported) onTalkEnd?.(); }
  };

  return (
    <div className="aura-car">
      <div className="aura-car__backdrop" aria-hidden="true">
        <AlbumArt track={track} size={420} radius={0} style={{ '--album-shadow': 'none' }}/>
      </div>
      <div className="aura-car__scrim" aria-hidden="true"/>

      <div className="aura-car__content">
        <div className="aura-car__top">
          <button onClick={() => { tap(8); onBack(); }} aria-label="exit car mode view" className="aura-car__chip" data-vaul-no-drag>
            <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true" style={{ transform: 'translateX(-1px)' }}>
              <path d="M8 1 L3 5 L8 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
          <span className="aura-car__brand">{djName.toLowerCase()} · car</span>
          <span className="aura-car__like" data-vaul-no-drag><HeartButton trackId={track.id} size={24}/></span>
        </div>

        <div className="aura-car__meta">
          <div className="aura-car__art" aria-hidden="true">
            <AlbumArt track={track} size={48} radius={12}/>
          </div>
          <div className="aura-car__metatext">
            <div className="aura-car__title">{cleanTitle(track.title)}</div>
            <div className="aura-car__artist">{track.artist}</div>
          </div>
        </div>

        <div className="aura-car__scrub" data-vaul-no-drag data-no-gesture>
          <ProgressRibbon progress={progress} accent="var(--color-accent)" dim="var(--color-line)"
            playing={playing} seed={track.id} onSeek={onSeek} height={28}/>
          <div className="aura-car__time">
            <MonoLabel className="text-ink-faint" size={12} numeric>{elapsed}</MonoLabel>
            <MonoLabel className="text-ink-faint" size={12} numeric>-{remaining}</MonoLabel>
          </div>
        </div>

        <div className="aura-car__tiles" data-vaul-no-drag>
          <button onClick={() => { tap(10); onPrev(); }} aria-label="previous" className="aura-car__tile">
            <svg width="44" height="32" viewBox="0 0 14 10" aria-hidden="true"><path d="M14 0 L5 5 L14 10 Z M3 0 H1 V10 H3 Z" fill="currentColor"/></svg>
            <span className="aura-car__tile-label">Prev</span>
          </button>
          <button onClick={() => { tap(10); onNext(); }} aria-label="next" className="aura-car__tile">
            <svg width="44" height="32" viewBox="0 0 14 10" aria-hidden="true"><path d="M0 0 L9 5 L0 10 Z M11 0 H13 V10 H11 Z" fill="currentColor"/></svg>
            <span className="aura-car__tile-label">Next</span>
          </button>
        </div>

        <button onClick={() => { tap(10); onTogglePlay(); }} aria-label={playing ? 'pause' : 'play'}
          className={`aura-car__play ${playing ? 'aura-car__play--playing' : ''}`} data-vaul-no-drag>
          {playing
            ? <svg width="30" height="34" viewBox="0 0 12 14" aria-hidden="true"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
            : <svg width="30" height="34" viewBox="0 0 12 14" aria-hidden="true" style={{ transform: 'translateX(2px)' }}><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
          <span className="aura-car__play-label">{playing ? 'Pause' : 'Play'}</span>
        </button>

        <div className="aura-car__voice" data-vaul-no-drag data-no-gesture>
          {voiceSupported ? (
            <button
              className={`aura-car__mic ${voiceListening ? 'aura-car__mic--on' : ''}`}
              aria-label={voiceListening ? 'listening — release to send' : 'hold to talk'}
              aria-pressed={voiceListening}
              onPointerDown={talkDown} onPointerUp={talkUp}
              onPointerLeave={talkUp} onPointerCancel={talkUp}
              onKeyDown={talkKeyDown} onKeyUp={talkKeyUp} onBlur={talkUp}
              onContextMenu={(e) => e.preventDefault()}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor"/>
                <path d="M5 11 a7 7 0 0 0 14 0 M12 18 v3 M8.5 21 h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
              <span>{voiceListening ? 'Listening…' : 'Hold to talk'}</span>
            </button>
          ) : (
            <div className="aura-car__mic aura-car__mic--off" aria-disabled="true">
              <span>Voice isn’t supported on this browser</span>
            </div>
          )}
          {/* Always mounted (not gated on voiceHint) so the aria-live region reliably
              announces, and the reserved min-height prevents a layout shift on hint. */}
          <div className="aura-car__voicehint" role="status">{voiceHint}</div>
        </div>
      </div>

      {/* Center glance overlay for the resolving "play <x>" path. Always mounted as a
          polite live region (so it announces reliably), pointer-events:none so it
          never traps the dashboard — the mic stays pressable to re-ask mid-resolve. */}
      <div className={`aura-car__glance ${glance ? `is-shown aura-car__glance--${glance}` : ''}`} role="status" aria-live="polite">
        <div className="aura-car__glance-card">
          {glance === 'thinking' && (
            <div className="aura-car__dots" aria-hidden="true">
              <span className="aura-car__dot" style={{ '--aura-thinking-delay': '0s' }}/>
              <span className="aura-car__dot" style={{ '--aura-thinking-delay': '0.18s' }}/>
              <span className="aura-car__dot" style={{ '--aura-thinking-delay': '0.36s' }}/>
            </div>
          )}
          <div className="aura-car__glance-text">{glanceText}</div>
        </div>
      </div>
    </div>
  );
}

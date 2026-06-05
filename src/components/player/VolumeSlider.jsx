import { useEffect, useRef, useState } from 'react';
// `aura-fadein` keyframe is defined in src/styles/animations.css.
import './VolumeSlider.css';

// Volume control bound to an audio player. Subscribes to the player's
// 'volume' and 'muted' events so external changes (M shortcut, ↑/↓ shortcut,
// other slider instance) keep this UI in sync. `compact` renders icon-only
// with a click-to-open popover for tight surfaces (e.g. FloatingMini).
//
// Slider is **uncontrolled** (defaultValue + imperative DOM updates via ref):
// three VolumeSlider instances all subscribe to `player.on('volume')`, so a
// controlled `value` prop would race with the user's in-flight drag — React
// resetting el.value mid-gesture cancels the browser's pointer capture and
// the thumb feels stuck. Writing value + --fill via ref keeps React out of
// the drag path entirely.
export function VolumeSlider({ player, compact = false, vertical = false }) {
  const sliderRef = useRef(null);
  const rootRef   = useRef(null);
  const [muted, setMuted] = useState(() => (player ? player.isMuted() : false));
  // Icon level is state (so the speaker glyph re-renders), but the slider
  // DOM is never touched by React after mount.
  const [iconLevel, setIconLevel] = useState(() => deriveIconLevel(player));
  const [open, setOpen] = useState(false);

  // Imperatively sync slider DOM value + --fill gradient. Used on mount and
  // on external 'volume' / 'muted' events. NEVER called from onChange — the
  // browser already moved the thumb during the drag, we'd just re-overwrite it.
  const syncSliderDom = (eff) => {
    const el = sliderRef.current;
    if (!el) return;
    const v = String(eff);
    if (el.value !== v) el.value = v;
    el.style.setProperty('--fill', v);
  };

  useEffect(() => {
    if (!player) return;
    syncSliderDom(player.isMuted() ? 0 : player.getVolume());
    const offVol = player.on('volume', (v) => {
      const m = player.isMuted();
      syncSliderDom(m ? 0 : v);
      setIconLevel(levelFor(m, v));
    });
    const offMut = player.on('muted', (m) => {
      setMuted(m);
      const v = player.getVolume();
      syncSliderDom(m ? 0 : v);
      setIconLevel(levelFor(m, v));
    });
    return () => { offVol(); offMut(); };
  }, [player]);

  // Re-sync the slider when the popover opens (compact mode) — slider was
  // unmounted while closed, so a fresh DOM node needs the current value.
  // Move focus into the slider so keyboard users can scrub immediately
  // instead of staying on the toggle button.
  useEffect(() => {
    if (compact && open && player) {
      syncSliderDom(player.isMuted() ? 0 : player.getVolume());
      sliderRef.current?.focus?.();
    }
  }, [compact, open, player]);

  // Close popover on outside click / Esc.
  useEffect(() => {
    if (!compact || !open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [compact, open]);

  if (!player) return null;

  const slider = (
    <input ref={sliderRef} type="range"
      min="0" max="1" step="0.01"
      defaultValue={muted ? 0 : player.getVolume()}
      onChange={(e) => {
        const v = Number(e.target.value);
        // Write --fill imperatively so the gradient tracks the thumb without
        // triggering a React render that would reset input.value mid-drag.
        e.target.style.setProperty('--fill', String(v));
        player.setVolume(v);
        if (muted && v > 0) player.setMuted(false);
      }}
      className={`aura-vol__slider ${muted ? 'aura-vol__slider--muted' : ''}`}
      aria-label="volume"/>
  );

  const icon = (
    <button type="button" onClick={() => {
      if (compact) setOpen(o => !o);
      else player.setMuted(!muted);
    }}
      aria-label={compact ? (open ? 'close volume' : 'open volume') : (muted ? 'unmute' : 'mute')}
      aria-haspopup={compact ? 'true' : undefined}
      aria-expanded={compact ? open : undefined}
      className={`aura-vol__btn ${muted ? 'aura-vol__btn--muted' : ''}`}>
      <SpeakerIcon level={iconLevel}/>
    </button>
  );

  // Vertical variant (mobile player, right edge): slider rotated above the
  // speaker toggle — louder at the top. Rotation reuses the horizontal track
  // gradient as-is (its left end maps to the bottom), so no separate CSS track.
  if (vertical) {
    return (
      <div ref={rootRef} className="aura-vol aura-vol--vertical">
        <div className="aura-vol__slider-wrap">{slider}</div>
        {icon}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="aura-vol">
      {icon}
      {compact ? (open && <div className="aura-vol__popover">{slider}</div>) : slider}
    </div>
  );
}

function levelFor(muted, v) {
  if (muted || v < 0.01) return 'mute';
  return v < 0.5 ? 'low' : 'high';
}
function deriveIconLevel(player) {
  if (!player) return 'high';
  return levelFor(player.isMuted(), player.getVolume());
}

function SpeakerIcon({ level }) {
  const muted = level === 'mute';
  const high  = level === 'high';
  const lowOrHigh = level === 'low' || high;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 5 H4 L7.5 2.5 V11.5 L4 9 H2 Z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      {lowOrHigh && (
        <path d="M9.4 5.4 Q10.6 7 9.4 8.6"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
      )}
      {high && (
        <path d="M11 4 Q13 7 11 10"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
      )}
      {muted && (
        <path d="M10 4.5 L13 7.5 M13 4.5 L10 7.5"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      )}
    </svg>
  );
}

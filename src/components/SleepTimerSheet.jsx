import { useEffect, useRef, useState } from 'react';
import { subscribeSleepSheet, closeSleepTimer } from '../lib/sleepTimerSheet';
import { start as startSleep, cancel as cancelSleep, subscribe as subscribeSleep } from '../lib/sleepTimer';
import { toast } from '../lib/toast';
import { BreathingDot, MonoLabel } from './primitives';
// `aura-fadein` keyframe is defined in src/styles/animations.css.
import './SleepTimerSheet.css';

const PRESETS = [10, 20, 30, 45, 60];

// Live MM:SS — the underlying timer ticks every 1000ms, so this re-renders in
// step with state pushes. ceil keeps it from skipping 0:00 to a perceived end.
function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

export function SleepTimerSheet() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ mode: null, remainingMs: null });
  const dialogRef = useRef(null);
  const opener = useRef(null);
  useEffect(() => subscribeSleepSheet(setOpen), []);
  useEffect(() => subscribeSleep(setState), []);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    // Focus first interactive on open; Tab wraps within the dialog so
    // keyboard users don't get dumped into the page beneath.
    const tabbable = () => Array.from(
      dialogRef.current?.querySelectorAll('button:not([disabled])') ?? [],
    );
    tabbable()[0]?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { closeSleepTimer(); return; }
      if (e.key !== 'Tab') return;
      const list = tabbable();
      if (!list.length) return;
      const first = list[0];
      const last  = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const active = state.mode !== null;

  const arm = (mins) => {
    startSleep(mins * 60 * 1000);
    toast(`sleep in ${mins} min.`);
    closeSleepTimer();
  };
  const armEndOfSet = () => {
    startSleep('end-of-set');
    toast('sleep at end of set.');
    closeSleepTimer();
  };
  const onCancel = () => {
    cancelSleep();
    toast('sleep timer cancelled.');
    closeSleepTimer();
  };

  return (
    <>
      <div className="aura-sleep-backdrop" onClick={closeSleepTimer}/>
      <div ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby="aura-sleep-title"
        className="aura-sleep" onClick={(e) => e.stopPropagation()}>
        <div id="aura-sleep-title" className="aura-sleep__title">sleep timer</div>
        {active && (
          <div className="aura-sleep__active">
            <div className="aura-sleep__active-row">
              <BreathingDot color="var(--color-accent)"/>
              {state.mode === 'duration' ? (
                <span className="aura-sleep__count">{fmtCountdown(state.remainingMs)}</span>
              ) : (
                <span className="aura-sleep__count aura-sleep__count--text">end of set</span>
              )}
            </div>
            <MonoLabel className="aura-sleep__caption text-ink-faint" size={9}>
              {state.mode === 'duration' ? 'until sleep' : 'sleep when the set finishes'}
            </MonoLabel>
          </div>
        )}
        <div className="aura-sleep__list">
          {PRESETS.map(m => (
            <button key={m} className="aura-sleep__btn" onClick={() => arm(m)}>{m} min</button>
          ))}
          <button className="aura-sleep__btn aura-sleep__btn--end" onClick={armEndOfSet}>
            end of set
          </button>
        </div>
        <div className="aura-sleep__actions">
          {active && (
            <button className="aura-sleep__action aura-sleep__action--cancel" onClick={onCancel}>
              cancel timer
            </button>
          )}
          <button className="aura-sleep__action" onClick={closeSleepTimer}>close</button>
        </div>
      </div>
    </>
  );
}

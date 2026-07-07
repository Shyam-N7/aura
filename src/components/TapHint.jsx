import { useEffect, useState } from 'react';
import { hintDone, bumpHint, claimHint, releaseHint, waitForHintSlot } from '../lib/tapHint';
import './TapHint.css';

// A proactive "this is tappable" hint — looping hand dip + ripple + a small
// lowercase label, absolutely positioned inside the host (which provides
// position:relative). Purely decorative: aria-hidden, no pointer events, and
// the HOST kills it permanently (lib/tapHint killHint) inside its real
// interaction handler; flipping `show` off hides it immediately.
// If another hint holds the one-at-a-time slot, this one waits its turn; a
// shown hint retires itself after autoHideMs so it can't hog the slot (or
// nag) for the rest of the session.
export function TapHint({ id, label, delayMs = 2400, placement = 'above', show = true, autoHideMs = 8000 }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show || hintDone(id)) return undefined;   // cleanup below hides on show-flip
    let hideTimer;
    let unwait;
    const attempt = () => {
      if (hintDone(id)) return;                    // killed while waiting
      if (!claimHint(id)) { unwait = waitForHintSlot(attempt); return; }
      if (!bumpHint(id)) { releaseHint(id); return; }
      setVisible(true);
      hideTimer = setTimeout(() => { setVisible(false); releaseHint(id); }, autoHideMs);
    };
    const t = setTimeout(attempt, delayMs);
    return () => {
      clearTimeout(t);
      clearTimeout(hideTimer);
      unwait?.();
      releaseHint(id);
      setVisible(false);
    };
  }, [id, show, delayMs, autoHideMs]);

  if (!visible) return null;
  return (
    <span className={`aura-taphint aura-taphint--${placement}`} aria-hidden="true">
      <span className="aura-taphint__stage">
        <span className="aura-taphint__ripple"/>
        <svg className="aura-taphint__hand" width="26" height="30" viewBox="0 0 24 28" fill="none">
          <path
            d="M10 14 V5.5 a2 2 0 0 1 4 0 V13 l4.2 1.2 a3 3 0 0 1 2.1 3.4 l-1 5.2 a4 4 0 0 1 -3.9 3.2 h-4.6 a4 4 0 0 1 -3.2 -1.6 L4 19.5 a2.6 2.6 0 0 1 3.8 -3.4 l2.2 1.9 Z"
            stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="var(--color-bg)"/>
        </svg>
      </span>
      {label && <span className="aura-taphint__label">{label}</span>}
    </span>
  );
}

import { useEffect, useRef, useState } from 'react';
import { subscribeShortcutsHelp, closeShortcutsHelp } from '../lib/shortcutsHelp';
// `aura-fadein` keyframe is defined in src/styles/animations.css.
import './ShortcutsOverlay.css';

const SHORTCUTS = [
  { keys: ['Space'],        label: 'play / pause' },
  { keys: ['←'],            label: 'seek back 10s' },
  { keys: ['→'],            label: 'seek forward 10s' },
  { keys: ['⇧', '←'],       label: 'previous track' },
  { keys: ['⇧', '→'],       label: 'next track' },
  { keys: ['L'],            label: 'like / unlike' },
  { keys: ['M'],            label: 'mute / unmute' },
  { keys: ['↑'],            label: 'volume up' },
  { keys: ['↓'],            label: 'volume down' },
  { keys: ['R'],            label: 'cycle repeat (off / all / one)' },
  { keys: ['S'],            label: 'shuffle up-next' },
  { keys: ['/'],            label: 'focus search' },
  { keys: ['?'],            label: 'show this help' },
  { keys: ['Esc'],          label: 'close overlay' },
];

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const opener = useRef(null);
  useEffect(() => subscribeShortcutsHelp(setOpen), []);
  useEffect(() => {
    if (!open) return;
    // Save the element that triggered the open so we can restore focus on
    // close — keyboard users land back where they were instead of at the
    // top of the page.
    opener.current = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') closeShortcutsHelp();
      // The dialog has no interactive children — Tab would escape into the
      // page beneath. Keep focus pinned to the dialog so screen-reader users
      // and keyboard users don't lose context.
      if (e.key === 'Tab') {
        e.preventDefault();
        dialogRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="aura-shortcuts-backdrop" onClick={closeShortcutsHelp}/>
      <div ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby="aura-shortcuts-title" tabIndex={-1}
        className="aura-shortcuts" onClick={(e) => e.stopPropagation()}>
        <div id="aura-shortcuts-title" className="aura-shortcuts__title">keyboard shortcuts</div>
        <dl className="aura-shortcuts__list">
          {SHORTCUTS.map(({ keys, label }) => (
            <ShortcutRow key={label} keys={keys} label={label}/>
          ))}
        </dl>
        <div className="aura-shortcuts__hint">press esc or click outside</div>
      </div>
    </>
  );
}

function ShortcutRow({ keys, label }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{keys.map((k, i) => <kbd key={i} className="aura-shortcuts__key">{k}</kbd>)}</dd>
    </>
  );
}

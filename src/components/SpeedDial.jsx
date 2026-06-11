import { useEffect, useRef, useState } from 'react';
import { AuraMark } from './primitives';
import './SpeedDial.css';

// AURA quick-action speed dial (compact surfaces only — desktop has the rails).
// The FAB is the AuraMark; tapping blooms a stack of quick actions up out of it,
// each rising with the same scale-out-of-the-icon feel as the equalizer morph.
// Closes on outside-tap / Esc / action. `actions` items: { id, label, icon,
// onClick, show? }.
export function SpeedDial({ actions = [] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const items = actions.filter(a => a && a.show !== false);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div ref={rootRef} className={`aura-sd ${open ? 'is-open' : ''}`}>
      <div className="aura-sd__items" role="menu" aria-hidden={!open}>
        {items.map((a, i) => (
          <button key={a.id} type="button" role="menuitem" tabIndex={open ? 0 : -1}
            className="aura-sd__item"
            // stagger from the FAB outward — the nearest item leads
            style={{ '--i': items.length - 1 - i }}
            onClick={() => { setOpen(false); a.onClick?.(); }}>
            <span className="aura-sd__item-label">{a.label}</span>
            <span className="aura-sd__item-icon">{a.icon}</span>
          </button>
        ))}
      </div>
      <button type="button" className="aura-sd__fab" aria-label="quick actions"
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="aura-sd__fab-mark"><AuraMark size={24}/></span>
        <span className="aura-sd__fab-cross" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 16 16">
            <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
          </svg>
        </span>
      </button>
    </div>
  );
}

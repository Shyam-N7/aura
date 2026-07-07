import { useEffect, useRef, useState } from 'react';
import { Drawer, DrawerContent, DrawerTitle } from './ui/drawer';
import { MonoLabel } from './primitives';
import { subscribeWhatsNew, markSeen } from '../lib/whatsNew';
import { useViewport, isCompactBreakpoint } from '../hooks/useViewport';
import './WhatsNewSheet.css';

// The announcement content, shared by both shells and exported for tests.
export function WhatsNewBody({ releases, onDone }) {
  return (
    <div className="aura-wn">
      {releases.map(r => (
        <section key={r.id} className="aura-wn__release">
          <MonoLabel className="text-ink-faint block" size={9}>{r.date}</MonoLabel>
          <h3 className="aura-wn__title">{r.title}</h3>
          <ul className="aura-wn__items">
            {r.items.map((it, i) => (
              <li key={i} className="aura-wn__item">
                <span className="aura-wn__item-title">{it.title}</span>
                <span className="aura-wn__item-body">{it.body}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button type="button" className="aura-wn__done" onClick={onDone} autoFocus>nice</button>
    </div>
  );
}

// Bus-driven what's-new host: bottom sheet on compact (vaul owns slide/drag/
// focus/scroll-lock, like AddToPlaylistSheet), centered card on desktop (the
// ConfirmDialog shape). EVERY dismissal — done button, drag-down, backdrop,
// Esc — marks the latest release seen, so it never re-nags.
export function WhatsNewSheet() {
  const [event, setEvent] = useState(null);
  // Keep last event so the drawer has content through vaul's slide-down.
  const lastRef = useRef(null);
  if (event) lastRef.current = event;

  useEffect(() => subscribeWhatsNew(setEvent), []);

  const { breakpoint } = useViewport();
  const compact = isCompactBreakpoint(breakpoint);

  const dismiss = () => { markSeen(); setEvent(null); };

  // Esc for the card shell (the drawer handles its own keys).
  useEffect(() => {
    if (!event || compact) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [event, compact]);

  if (compact) {
    const data = event ?? lastRef.current;
    return (
      <Drawer open={!!event} repositionInputs={false} onOpenChange={(o) => { if (!o) dismiss(); }}>
        {data && (
          <DrawerContent className="aura-drawer__content--whatsnew">
            <div className="aura-sheet-header">
              <DrawerTitle className="aura-sheet-title">what’s new</DrawerTitle>
            </div>
            <div className="aura-wn__scroll">
              <WhatsNewBody releases={data.releases} onDone={dismiss}/>
            </div>
          </DrawerContent>
        )}
      </Drawer>
    );
  }

  if (!event) return null;
  return (
    <>
      <div className="aura-wn-backdrop" onClick={dismiss}/>
      <div className="aura-wn-card" role="dialog" aria-modal="true" aria-label="what's new"
        onClick={(e) => e.stopPropagation()}>
        <div className="aura-wn-card__title">what’s new</div>
        <div className="aura-wn__scroll">
          <WhatsNewBody releases={event.releases} onDone={dismiss}/>
        </div>
      </div>
    </>
  );
}

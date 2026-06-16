import { useEffect, useRef, useState } from 'react';
import './BackToTop.css';

// "Back to top" button for long scroll views. Pass the same ref that scrolls
// (e.g. the one from useScrollMemory). It renders a zero-height sticky anchor —
// drop it in as the LAST child of the scroll container — so the button sits at a
// fixed spot just above the bottom bar without taking layout space.
//
// It is NOT persistent: it surfaces while you're scrolling (once past
// `threshold`) and auto-hides `hideDelay` ms after you stop, so it never lingers
// on top of your content. Any further scroll brings it back; hovering it keeps
// it up long enough to click.
export function BackToTop({ scrollRef, threshold = 480, hideDelay = 3000 }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const hoveredRef = useRef(false);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return undefined;

    const armHide = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!hoveredRef.current) setVisible(false);
      }, hideDelay);
    };

    const onScroll = () => {
      if (el.scrollTop > threshold) {
        setVisible(true);
        armHide();              // each scroll restarts the idle countdown
      } else {
        clearTimeout(timerRef.current);
        setVisible(false);      // near the top → not needed
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(timerRef.current); };
  }, [scrollRef, threshold, hideDelay]);

  const toTop = () => scrollRef?.current?.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="aura-btt-anchor" aria-hidden={!visible}>
      <button
        type="button"
        onClick={toTop}
        onMouseEnter={() => { hoveredRef.current = true; clearTimeout(timerRef.current); }}
        onMouseLeave={() => {
          hoveredRef.current = false;
          timerRef.current = setTimeout(() => setVisible(false), hideDelay);
        }}
        tabIndex={visible ? 0 : -1}
        className={`aura-btt ${visible ? 'aura-btt--in' : 'aura-btt--out'}`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 11.5 V3 M3 7 L7 3 L11 7"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Take me back up</span>
      </button>
    </div>
  );
}

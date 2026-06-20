import { useRef } from 'react';
import { classifyGesture, isDoubleTap } from './heroGestures';

// One unified pointer pipeline for the player cover: swipe up -> next, swipe down
// -> close, double-tap -> like, single tap -> no-op. A single pointerdown/up pair
// (no competing listeners) so taps and swipes never race each other, and the cover
// is data-vaul-no-drag so this never fights the drawer's own drag-to-dismiss.
// Returns props to spread on the hero element.
export function useHeroGestures({ onNext, onClose, onLike }) {
  const start = useRef(null);
  const lastTapAt = useRef(0);

  return {
    onPointerDown(e) {
      // The gesture spans the whole player surface, so ignore presses that begin
      // on a control — buttons, links, inputs, and the scrubber (data-no-gesture)
      // own their own interaction. Everything else is gesture.
      if (e.target?.closest?.('button, a, input, [data-no-gesture]')) { start.current = null; return; }
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerCancel() { start.current = null; },
    onPointerUp(e) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const g = classifyGesture(e.clientX - s.x, e.clientY - s.y);
      if (g === 'swipe-up') { lastTapAt.current = 0; onNext?.(); return; }
      if (g === 'swipe-down') { lastTapAt.current = 0; onClose?.(); return; }
      if (g !== 'tap') return;
      // Tap: a second tap inside the window is a double-tap (like); otherwise just
      // arm for the next one. A lone tap does nothing.
      if (isDoubleTap(e.timeStamp, lastTapAt.current)) { lastTapAt.current = 0; onLike?.(); }
      else { lastTapAt.current = e.timeStamp; }
    },
  };
}

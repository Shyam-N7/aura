import { useState, useEffect, useRef } from 'react';

export function useCinematicIdle(panelRef, timeoutMs = 5000) {
  const [cinematic, setCinematic] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const reset = () => {
      setCinematic(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCinematic(true), timeoutMs);
    };
    timer.current = setTimeout(() => setCinematic(true), timeoutMs);
    const events = ['pointermove', 'pointerdown', 'touchstart', 'keydown'];
    events.forEach(e => el.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer.current);
      events.forEach(e => el.removeEventListener(e, reset));
    };
  }, [panelRef, timeoutMs]);

  return cinematic;
}

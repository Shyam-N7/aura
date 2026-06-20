import { useEffect, useRef } from 'react';
import './TapRipple.css';

// App-wide touch ripple — ONE top-level fixed layer (not per-element injection,
// which clips the ripple inside small buttons). A single delegated pointerdown
// spawns a ripple at the touch point for interactive targets; it lives in the
// layer (above the tapped element), so it never clips. Touch-only + reduced-
// motion aware. Spans are created/removed via the DOM (no React churn per tap).
const INTERACTIVE = 'button, a[href], [role="button"], [data-ripple]';
// Surfaces that own their own gesture/visuals — no ripple there.
const EXCLUDE = 'input, textarea, select, [contenteditable], [data-no-ripple], .aura-mp, .aura-qps__ring';

export function TapRipple() {
  const layerRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!coarse || reduce) return undefined;

    const onDown = (e) => {
      if (e.pointerType === 'mouse') return;
      const t = e.target;
      const hit = t?.closest?.(INTERACTIVE);
      if (!hit || t.closest(EXCLUDE)) return;
      const layer = layerRef.current;
      if (!layer) return;
      const r = hit.getBoundingClientRect();
      const d = Math.min(Math.max(Math.min(r.width, r.height) * 1.7, 46), 200);
      const span = document.createElement('span');
      span.className = 'aura-ripple';
      span.style.left = `${e.clientX}px`;
      span.style.top = `${e.clientY}px`;
      span.style.width = `${d}px`;
      span.style.height = `${d}px`;
      span.addEventListener('animationend', () => span.remove(), { once: true });
      layer.appendChild(span);
    };

    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  return <div ref={layerRef} className="aura-ripple-layer" aria-hidden="true"/>;
}

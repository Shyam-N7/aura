import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

// A distinctive music-app cursor: a soft accent RING (with a faint inner glow)
// that trails the real pointer, swells over interactive elements, and — on click
// — emits an expanding "sound-wave" ripple from the click point. Fine-pointer
// only (no touch), disabled under reduced motion, pointer-events:none throughout
// so it never intercepts clicks.
const INTERACTIVE = 'a, button, input, [role="button"], .lp-chip, .feature, .problem-card, .test-card, .step-card, .store-badge';

export function CursorFollower() {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduce) return undefined;   // touch / reduced-motion: no cursor

    const host = el.parentNode;
    gsap.set(el, { xPercent: -50, yPercent: -50, opacity: 0 });
    // Lag the ring behind the pointer for a smooth, weighted trail.
    const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3' });

    let shown = false;
    const move = (e) => {
      if (!shown) { gsap.to(el, { opacity: 1, duration: 0.3 }); shown = true; }
      xTo(e.clientX);
      yTo(e.clientY);
    };
    const over = (e) => { if (e.target.closest?.(INTERACTIVE)) el.classList.add('is-active'); };
    const out = (e) => {
      if (e.target.closest?.(INTERACTIVE) && !e.relatedTarget?.closest?.(INTERACTIVE)) {
        el.classList.remove('is-active');
      }
    };

    // Click feedback: the ring contracts, AND a ripple expands from the click
    // point like a sound wave — clear, tactile "you clicked" signal.
    const down = (e) => {
      el.classList.add('is-down');
      const ripple = document.createElement('span');
      ripple.className = 'lp-cursor-ripple';
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      host.appendChild(ripple);
      gsap.fromTo(ripple,
        { scale: 0.3, opacity: 0.7 },
        { scale: 2.6, opacity: 0, duration: 0.6, ease: 'power2.out',
          onComplete: () => ripple.remove() });
    };
    const up = () => el.classList.remove('is-down');
    // Re-arm `shown` so re-entering the window fades the ring back in (without
    // this, the one-shot guard latches and the cursor stays invisible for good).
    const leave = () => { shown = false; gsap.to(el, { opacity: 0, duration: 0.3 }); };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerover', over, { passive: true });
    window.addEventListener('pointerout', out, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('pointerleave', leave);

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerout', out);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      document.removeEventListener('pointerleave', leave);
      host.querySelectorAll('.lp-cursor-ripple').forEach((r) => r.remove());
    };
  }, []);

  return <div ref={ref} className="lp-cursor" aria-hidden="true" />;
}

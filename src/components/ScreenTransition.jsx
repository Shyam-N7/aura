import { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

// Centralized GSAP page-transition wrapper — replaces the per-screen CSS
// `animate-aura-screen-in` keyframe (Phase 2). Each active screen mounts inside
// one of these; on mount it runs a GSAP enter timeline (rise + fade + subtle
// scale), and the player route runs a dismiss timeline while it's closing (App
// keeps it mounted via `closingPlayer` for the duration). gsap CORE only — no
// ScrollTrigger/Lenis — so the main bundle gains the engine, not the landing
// plugins.
//
// The `animate-aura-screen-in` class is KEPT on the wrapper as a layout/selector
// hook only (responsive.css bottom-chrome spacer, MobilePlayer.css insets,
// DesktopSearch.css) — its CSS *animation* was removed (the --animate-* theme var
// + keyframes) so GSAP is the single source of the motion (no double-animation).
//
// - reduced motion → no tween at all (screens appear instantly; matchMedia is the
//   single gate, same contract as the landing useGsap hook)
// - `noEnter` skips the GSAP enter (mobile search owns a bespoke CSS animation via
//   .aura-search-screen; the wrapper still carries the marker class for spacers)
// - `out` runs the dismiss timeline (player close)

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function ScreenTransition({ className = '', noEnter = false, out = false, children }) {
  const ref = useRef(null);

  // Enter on mount. useLayoutEffect so the from-state applies before paint (no
  // flash of the final position). Each active screen is freshly keyed in App, so
  // this runs once per screen instance.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || noEnter || reduced()) return undefined;
    const tw = gsap.fromTo(el,
      { autoAlpha: 0, y: 14, scale: 0.985 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.42, ease: 'power3.out', clearProps: 'all' });
    return () => tw.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss timeline — runs when `out` flips true (player close). App unmounts the
  // wrapper after its own ~220ms timer, so this just plays the exit.
  useEffect(() => {
    const el = ref.current;
    if (!el || !out || reduced()) return undefined;
    const tw = gsap.to(el, { autoAlpha: 0, y: 12, scale: 0.92, duration: 0.22, ease: 'power2.in' });
    return () => tw.kill();
  }, [out]);

  return <div ref={ref} className={`absolute inset-0 animate-aura-screen-in ${className}`}>{children}</div>;
}

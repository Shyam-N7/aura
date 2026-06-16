import { useLayoutEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

// GSAP + Lenis live only in this landing-page module tree, so they ship in the
// lazy landing chunk (logged-out visitors) and never the main app bundle.

let registered = false;
function ensurePlugins() {
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
}

// The live Lenis instance for the page (set on the page-level useGsap call only).
// Used by landingScrollTo so nav/footer anchor jumps go through the smooth engine.
let lenisInstance = null;

/* Smooth-scroll an anchor target. Routes through Lenis when active; falls back to
   native smooth scrollIntoView (reduced-motion / no Lenis). */
export function landingScrollTo(target, opts) {
  if (!target) return;
  if (lenisInstance) lenisInstance.scrollTo(target, { offset: -72, duration: 1.1, ...(opts || {}) });
  else target.scrollIntoView({ behavior: 'smooth' });
}

/* ── useGsap ────────────────────────────────────────────────────────────
   Runs `setup` inside a gsap.context scoped to scopeRef — but ONLY when the
   user hasn't requested reduced motion. gsap.matchMedia is the single source
   of truth: under `reduce` the block never runs, so no from()/draw is applied
   and every element keeps its natural, fully-visible state.

   useLayoutEffect (not useEffect) so from()/set() apply before the browser
   paints — no flash of the final state. The whole context is reverted on
   unmount, which kills the tweens AND their ScrollTriggers (StrictMode-safe).
   `setup` receives { gsap, ScrollTrigger, q, root }; `q` is a selector scoped
   to the ref subtree so nothing can leak to shared components elsewhere.

   IMPORTANT: this page scrolls INSIDE `.aura-landing` (the app pins #root with
   position:fixed; overflow:hidden), not the window. ScrollTrigger watches the
   window by default, so without pointing it at the real scroll container no
   trigger below the fold ever fires — the from()'d elements would stay hidden.
   ──────────────────────────────────────────────────────────────────────── */
export function useGsap(scopeRef, setup) {
  useLayoutEffect(() => {
    const root = scopeRef.current;
    if (!root) return undefined;
    ensurePlugins();
    // The landing's scroll container (self for the page-level call; the nearest
    // landing ancestor for per-spotlight calls).
    const scroller = root.closest('.aura-landing') ?? root;
    ScrollTrigger.defaults({ scroller });
    const isPage = scroller === root;   // page-level call vs per-spotlight call
    let mm;
    let lenis;
    let tick;
    const ctx = gsap.context(() => {
      mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // Inertia smooth-scroll — the foundation of the "continuous" feel. Only
        // for the page-level call (the .aura-landing scroller), and only when
        // motion is allowed. Lenis eases the container's native scrollTop, which
        // ScrollTrigger reads, so the two stay in sync (no scrollerProxy needed).
        if (isPage) {
          // Guard the whole setup: if Lenis ever fails to init, the page must
          // still scroll natively (normal flow) — never let smoothing break it.
          try {
            lenis = new Lenis({
              wrapper: root,
              content: root.querySelector('.lp-scroll') ?? root.firstElementChild ?? undefined,
              lerp: 0.09,
              smoothWheel: true,
            });
            lenisInstance = lenis;
            lenis.on('scroll', ScrollTrigger.update);
            tick = (t) => lenis.raf(t * 1000);
            gsap.ticker.add(tick);
            gsap.ticker.lagSmoothing(0);
          } catch {
            lenis = undefined;
          }
        }
        setup({ gsap, ScrollTrigger, q: gsap.utils.selector(root), root, scroller });
      });
    }, root);
    // Webfonts (Fraunces/Dancing Script/Hanken) load async and reflow the page
    // after triggers are measured — recompute their positions once fonts settle.
    if (document.fonts?.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
    // Revert the context (kills tweens + their ScrollTriggers), tear down Lenis,
    // and kill the matchMedia so its query listener can't leak across remounts.
    return () => {
      if (lenis) {
        gsap.ticker.remove(tick);
        gsap.ticker.lagSmoothing(500, 33);
        lenis.destroy();
        if (lenisInstance === lenis) lenisInstance = null;
      }
      ctx.revert();
      mm?.kill();
    };
    // `setup` is defined at module/component scope (stable identity); we run it
    // once for the lifetime of the scope element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRef]);
}

/* A one-shot tactile "pop" for chip/pill taps — self-completing (~0.24s) so it
   needs no context or cleanup. Skipped entirely under reduced motion (the chip
   still shows its `.is-on` state change via CSS). */
export function chipPop(el) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Springy overshoot pop, then settle back to rest.
  gsap.fromTo(
    el,
    { scale: 0.9 },
    { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)', overwrite: true, clearProps: 'transform' },
  );
}

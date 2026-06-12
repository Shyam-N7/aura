import { useEffect, useState } from 'react';

// Breakpoint thresholds from the design handoff:
//   ≥1700 = large-desktop, ≥1280 = desktop, ≥900 = tablet-landscape,
//   ≥600  = tablet-portrait, else mobile.
function readBreakpoint(width) {
  if (width >= 1700) return 'large-desktop';
  if (width >= 1280) return 'desktop';
  if (width >= 900)  return 'tablet-landscape';
  if (width >= 600)  return 'tablet-portrait';
  return 'mobile';
}

// Pure + exported for tests. The width-only breakpoints mis-file a rotated
// phone (844×390 reads as "tablet-portrait" → a clipped 402×874 preview
// frame), so classification also raises a `phoneLandscape` flag: landscape
// aspect + phone-short height + sub-tablet width + a touch pointer (so a
// 900×450 desktop browser window never counts). Root responds by keeping the
// portrait mobile UI mounted and covering it with the rotate prompt — audio
// and screen state survive the rotation both ways.
export function classifyViewport({ width, height, coarse }) {
  const phoneLandscape =
    width > height &&
    height <= 500 &&
    width <= 1000 &&
    coarse;
  return { breakpoint: readBreakpoint(width), phoneLandscape };
}

function readViewport() {
  if (typeof window === 'undefined') {
    return { width: 1440, height: 900, breakpoint: 'desktop', phoneLandscape: false };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const coarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(any-pointer: coarse)').matches;
  return { width, height, ...classifyViewport({ width, height, coarse }) };
}

export function useViewport() {
  const [vp, setVp] = useState(readViewport);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVp(readViewport()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return vp;
}

export function isDesktopBreakpoint(bp) {
  // Tablet-landscape (900–1279) uses the desktop shell as an interim until
  // proper tablet variants ship (CompactNavRail + SlimPlayerRail).
  return bp === 'tablet-landscape' || bp === 'desktop' || bp === 'large-desktop';
}

// Compact = mobile OR tablet-portrait. These two share the same chrome
// treatment (TopNavStrip top + BottomMiniBar bottom) after the responsive
// flip — neither has horizontal real estate for the NavRail or DesktopRail.
export function isCompactBreakpoint(bp) {
  return bp === 'mobile' || bp === 'tablet-portrait';
}

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

function readViewport() {
  const w = typeof window === 'undefined' ? 1440 : window.innerWidth;
  return { width: w, breakpoint: readBreakpoint(w) };
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

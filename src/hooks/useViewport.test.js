import { describe, it, expect } from 'vitest';
import { classifyViewport } from './useViewport';

// Pins the phone-landscape heuristic: real phones rotated sideways (short +
// wide + touch) get the rotate prompt; tablets, laptops and resized desktop
// windows never do.
describe('classifyViewport', () => {
  const at = (width, height, coarse) => classifyViewport({ width, height, coarse });

  it('flags real phones held in landscape', () => {
    for (const [w, h] of [[667, 375], [740, 360], [844, 390], [932, 430]]) {
      expect(at(w, h, true).phoneLandscape).toBe(true);
    }
  });

  it('keeps phones in portrait on the mobile breakpoint', () => {
    expect(at(390, 844, true)).toEqual({ breakpoint: 'mobile', phoneLandscape: false });
  });

  it('leaves tablets alone in both orientations', () => {
    expect(at(768, 1024, true)).toEqual({ breakpoint: 'tablet-portrait', phoneLandscape: false });
    // 1024-wide landscape tablet: excluded by the width ceiling.
    expect(at(1024, 768, true).phoneLandscape).toBe(false);
  });

  it('never prompts on fine-pointer (desktop) windows, however short', () => {
    expect(at(900, 450, false).phoneLandscape).toBe(false);
    expect(at(932, 430, false).phoneLandscape).toBe(false);
    expect(at(1280, 800, false)).toEqual({ breakpoint: 'desktop', phoneLandscape: false });
    expect(at(1366, 768, false)).toEqual({ breakpoint: 'desktop', phoneLandscape: false });
  });
});

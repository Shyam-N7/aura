import { describe, it, expect } from 'vitest';
import { classifyGesture, isDoubleTap } from './heroGestures';

describe('classifyGesture — player cover gesture classifier', () => {
  it('treats tiny movement as a tap', () => {
    expect(classifyGesture(0, 0)).toBe('tap');
    expect(classifyGesture(8, -5)).toBe('tap');
    expect(classifyGesture(12, 12)).toBe('tap');
  });

  it('reads a clear upward drag as swipe-up (next)', () => {
    expect(classifyGesture(0, -60)).toBe('swipe-up');
    expect(classifyGesture(10, -80)).toBe('swipe-up');
  });

  it('reads a clear downward drag as swipe-down (close)', () => {
    expect(classifyGesture(0, 70)).toBe('swipe-down');
    expect(classifyGesture(-12, 90)).toBe('swipe-down');
  });

  it('ignores horizontal or ambiguous drags', () => {
    expect(classifyGesture(80, 0)).toBe('none');     // horizontal
    expect(classifyGesture(60, 50)).toBe('none');    // mostly horizontal
    expect(classifyGesture(0, 30)).toBe('none');     // vertical but under SWIPE_MIN
  });

  it('requires vertical to dominate horizontal for a swipe', () => {
    expect(classifyGesture(50, -55)).toBe('swipe-up');   // ady>adx
    expect(classifyGesture(55, -50)).toBe('none');       // adx>=ady → ignore
  });
});

describe('isDoubleTap — double-tap window', () => {
  it('is false on the first tap (no previous)', () => {
    expect(isDoubleTap(1000, 0)).toBe(false);
  });

  it('is true for a second tap inside the window', () => {
    expect(isDoubleTap(1200, 1000)).toBe(true);   // 200ms gap
    expect(isDoubleTap(1280, 1000)).toBe(true);   // exactly at the edge
  });

  it('is false for a second tap past the window', () => {
    expect(isDoubleTap(1400, 1000)).toBe(false);  // 400ms gap
  });
});

// Pure gesture classification for the player cover — kept separate from the React
// hook so the thresholds and decisions are unit-testable.
export const TAP_SLOP = 12;        // px — total travel at or under this reads as a tap
export const SWIPE_MIN = 48;       // px — vertical travel required to count as a swipe
export const DOUBLE_TAP_MS = 280;  // ms — max gap between taps for a double-tap

// Classify one pointer interaction from its total delta. A vertical swipe wins only
// when clearly vertical (ady > adx) and past the threshold; horizontal or ambiguous
// drags return 'none' so they never fire an action or fight the drawer.
export function classifyGesture(dx, dy, { tapSlop = TAP_SLOP, swipeMin = SWIPE_MIN } = {}) {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx <= tapSlop && ady <= tapSlop) return 'tap';
  if (ady > adx && ady >= swipeMin) return dy < 0 ? 'swipe-up' : 'swipe-down';
  return 'none';
}

// True when `now` falls within the double-tap window of the previous tap.
export function isDoubleTap(now, lastTapAt, { windowMs = DOUBLE_TAP_MS } = {}) {
  return lastTapAt > 0 && (now - lastTapAt) <= windowMs;
}

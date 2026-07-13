import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ctxOpen, ctxPress, toggleTrackMenu, closeTrackMenu, subscribeTrackMenu } from './trackContextMenu';

const track = { id: 't1', title: 'Song' };
const down = (x = 100, y = 100) => ({ pointerType: 'touch', clientX: x, clientY: y });
const ctxEvent = () => ({ clientX: 100, clientY: 100, preventDefault: vi.fn() });

let events, off;
beforeEach(() => {
  vi.useFakeTimers();
  closeTrackMenu();   // reset the module's open-track state between specs
  events = [];
  off = subscribeTrackMenu(e => events.push(e));
});
afterEach(() => {
  off();
  vi.useRealTimers();
});

describe('ctxOpen (right-click, unchanged contract)', () => {
  it('opens at the pointer and suppresses the OS menu', () => {
    const e = ctxEvent();
    ctxOpen(track)(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(events).toEqual([{ track, x: 100, y: 100 }]);
  });
});

describe('toggleTrackMenu (⋯ trigger)', () => {
  afterEach(() => closeTrackMenu());

  it('opens on first tap, closes on a second tap of the same track', () => {
    toggleTrackMenu({ track, x: 5, y: 6 });
    expect(events.at(-1)).toEqual({ track, x: 5, y: 6 });   // opened
    toggleTrackMenu({ track, x: 5, y: 6 });
    expect(events.at(-1)).toBe(null);                        // toggled closed
  });

  it('switches to another track rather than closing', () => {
    const other = { id: 't2', title: 'Other' };
    toggleTrackMenu({ track, x: 5, y: 6 });
    toggleTrackMenu({ track: other, x: 7, y: 8 });
    expect(events.at(-1)).toEqual({ track: other, x: 7, y: 8 });   // opened the new one, not closed
  });
});

describe('ctxPress (long-press)', () => {
  it('opens after a 500ms touch hold at the press position', () => {
    const h = ctxPress(track);
    h.onPointerDown(down(50, 60));
    vi.advanceTimersByTime(499);
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(events).toEqual([{ track, x: 50, y: 60 }]);
  });

  it('cancels when the finger moves more than the slop (a scroll, not a press)', () => {
    const h = ctxPress(track);
    h.onPointerDown(down(100, 100));
    h.onPointerMove({ clientX: 100, clientY: 115 });
    vi.advanceTimersByTime(600);
    expect(events).toHaveLength(0);
  });

  it('tolerates jitter inside the slop', () => {
    const h = ctxPress(track);
    h.onPointerDown(down(100, 100));
    h.onPointerMove({ clientX: 104, clientY: 103 });
    vi.advanceTimersByTime(600);
    expect(events).toHaveLength(1);
  });

  it('cancels on release before the threshold', () => {
    const h = ctxPress(track);
    h.onPointerDown(down());
    vi.advanceTimersByTime(300);
    h.onPointerUp();
    vi.advanceTimersByTime(600);
    expect(events).toHaveLength(0);
  });

  it('ignores mouse pointerdown (right-click path owns the mouse)', () => {
    const h = ctxPress(track);
    h.onPointerDown({ pointerType: 'mouse', clientX: 1, clientY: 1 });
    vi.advanceTimersByTime(600);
    expect(events).toHaveLength(0);
  });

  it("swallows Android's native contextmenu right after the timer fired (no double-open)", () => {
    const h = ctxPress(track);
    h.onPointerDown(down());
    vi.advanceTimersByTime(510);
    expect(events).toHaveLength(1);
    const e = ctxEvent();
    h.onContextMenu(e);                       // the native event arrives late
    expect(e.preventDefault).toHaveBeenCalled();
    expect(events).toHaveLength(1);           // still one open
    vi.advanceTimersByTime(800);              // suppression self-clears
    h.onContextMenu(ctxEvent());
    expect(events).toHaveLength(2);           // a real right-click works again
  });

  it('marks the row for the callout-suppressing CSS', () => {
    expect(ctxPress(track)['data-ctx-press']).toBe('');
  });
});

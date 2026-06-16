import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  registerActiveScroll, unregisterActiveScroll, emitActiveScroll,
  resetActiveScroll, subscribeActiveScroll, scrollActiveToTop,
} from './activeScroll';

const mkEl = () => ({ scrollTo: vi.fn() });

describe('activeScroll store', () => {
  afterEach(() => { registerActiveScroll(null); });   // clear the active element between tests

  it('broadcasts scroll from the active element to subscribers', () => {
    const cb = vi.fn();
    const unsub = subscribeActiveScroll(cb);
    const el = mkEl();
    registerActiveScroll(el);                 // new el → emits a 0 reset
    expect(cb).toHaveBeenCalledWith(0);
    cb.mockClear();
    emitActiveScroll(el, 540);
    expect(cb).toHaveBeenCalledWith(540);
    unsub();
  });

  it('ignores scroll from a non-active element', () => {
    const cb = vi.fn();
    const unsub = subscribeActiveScroll(cb);
    const a = mkEl(), b = mkEl();
    registerActiveScroll(a);
    cb.mockClear();
    emitActiveScroll(b, 700);
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('resets only when a genuinely new element registers, not on re-register', () => {
    const cb = vi.fn();
    const unsub = subscribeActiveScroll(cb);
    const a = mkEl();
    registerActiveScroll(a);
    expect(cb).toHaveBeenCalledWith(0);
    cb.mockClear();
    registerActiveScroll(a);                  // same el → no reset
    expect(cb).not.toHaveBeenCalled();
    registerActiveScroll(mkEl());             // new el → reset
    expect(cb).toHaveBeenCalledWith(0);
    unsub();
  });

  it('emits a 0 reset and then stops broadcasting when the active element unregisters', () => {
    const cb = vi.fn();
    const unsub = subscribeActiveScroll(cb);
    const el = mkEl();
    registerActiveScroll(el);
    cb.mockClear();
    unregisterActiveScroll(el);
    expect(cb).toHaveBeenCalledWith(0);     // collapse the morph the moment the screen leaves
    cb.mockClear();
    emitActiveScroll(el, 600);              // no longer the active element
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('unregistering a non-active element is a no-op', () => {
    const cb = vi.fn();
    const unsub = subscribeActiveScroll(cb);
    const a = mkEl();
    registerActiveScroll(a);
    cb.mockClear();
    unregisterActiveScroll(mkEl());         // not the active one (e.g. an outgoing screen during a transition)
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('resetActiveScroll broadcasts 0 for the active element only (arrival / scroll-restore)', () => {
    const cb = vi.fn();
    const unsub = subscribeActiveScroll(cb);
    const el = mkEl();
    registerActiveScroll(el);
    cb.mockClear();
    resetActiveScroll(el);
    expect(cb).toHaveBeenCalledWith(0);
    cb.mockClear();
    resetActiveScroll(mkEl());              // non-active → ignored
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('scrollActiveToTop smooth-scrolls the active element', () => {
    const el = mkEl();
    registerActiveScroll(el);
    scrollActiveToTop();
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});

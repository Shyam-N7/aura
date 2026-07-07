import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hintDone, killHint, bumpHint, claimHint, releaseHint, waitForHintSlot, setHintsSuspended, _resetHintBus } from './tapHint';

beforeEach(() => {
  localStorage.clear();
  _resetHintBus();
});

describe('tapHint storage', () => {
  it('killHint is permanent and hintDone reflects it', () => {
    expect(hintDone('x')).toBe(false);
    killHint('x');
    expect(hintDone('x')).toBe(true);
    expect(bumpHint('x')).toBe(false);
  });

  it('bumpHint allows exactly three showings, then refuses forever', () => {
    expect(bumpHint('x')).toBe(true);
    expect(bumpHint('x')).toBe(true);
    expect(bumpHint('x')).toBe(true);
    expect(bumpHint('x')).toBe(false);
    expect(localStorage.getItem('aura.hint.x')).toBe('3');
  });
});

describe('tapHint arbitration', () => {
  it('one live hint at a time; release frees the slot', () => {
    expect(claimHint('a')).toBe(true);
    expect(claimHint('b')).toBe(false);
    expect(claimHint('a')).toBe(true);   // re-claim by the holder is fine
    releaseHint('a');
    expect(claimHint('b')).toBe(true);
  });

  it('suspension (tour active) refuses every claim', () => {
    setHintsSuspended(true);
    expect(claimHint('a')).toBe(false);
    setHintsSuspended(false);
    expect(claimHint('a')).toBe(true);
  });

  it('notifies waiters when the slot frees', () => {
    const cb = vi.fn();
    claimHint('a');
    waitForHintSlot(cb);
    releaseHint('b');            // not the holder — nothing frees
    expect(cb).not.toHaveBeenCalled();
    releaseHint('a');
    expect(cb).toHaveBeenCalledTimes(1);
    releaseHint('a');            // one-shot: consumed waiters don't refire
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('notifies waiters when suspension lifts, and unsubscribe works', () => {
    const stays = vi.fn();
    const leaves = vi.fn();
    setHintsSuspended(true);
    waitForHintSlot(stays);
    waitForHintSlot(leaves)();   // subscribe then immediately unsubscribe
    setHintsSuspended(false);
    expect(stays).toHaveBeenCalledTimes(1);
    expect(leaves).not.toHaveBeenCalled();
  });
});

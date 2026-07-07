import { describe, it, expect, beforeEach } from 'vitest';
import { hintDone, killHint, bumpHint, claimHint, releaseHint, setHintsSuspended, _resetHintBus } from './tapHint';

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
});

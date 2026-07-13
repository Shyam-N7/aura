import { describe, it, expect } from 'vitest';
import { relTime } from './relTime';

const now = Date.UTC(2026, 6, 11, 12, 0, 0);
const ago = (ms) => now - ms;
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe('relTime', () => {
  it('returns empty for missing/invalid timestamps', () => {
    expect(relTime(null, now)).toBe('');
    expect(relTime(0, now)).toBe('');
    expect(relTime('nope', now)).toBe('');
  });

  it('walks the buckets: just now → m → h → d → w', () => {
    expect(relTime(ago(10 * S), now)).toBe('just now');
    expect(relTime(ago(5 * M), now)).toBe('5m ago');
    expect(relTime(ago(3 * H), now)).toBe('3h ago');
    expect(relTime(ago(2 * D), now)).toBe('2d ago');
    expect(relTime(ago(2 * 7 * D), now)).toBe('2w ago');
  });

  it('falls back to a short date past ~a month', () => {
    expect(relTime(ago(60 * D), now)).toMatch(/[a-z]{3}/);   // e.g. "12 may"
  });

  it('accepts a numeric string (BIGINT from pg)', () => {
    expect(relTime(String(ago(2 * H)), now)).toBe('2h ago');
  });
});

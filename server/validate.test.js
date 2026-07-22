import { describe, it, expect } from 'vitest';
import { isId, clampInt, MAX_ID_LEN } from './validate.js';

describe('isId', () => {
  it('accepts real catalog/db id shapes', () => {
    expect(isId('dQw4w9WgXcQ')).toBe(true);
    expect(isId('u_1a2b3c')).toBe(true);
    expect(isId('inv_' + 'a'.repeat(24))).toBe(true);
    expect(isId('a'.repeat(MAX_ID_LEN))).toBe(true);
  });
  it('rejects non-strings, empties and oversized junk', () => {
    expect(isId('')).toBe(false);
    expect(isId('a'.repeat(MAX_ID_LEN + 1))).toBe(false);
    expect(isId(null)).toBe(false);
    expect(isId(undefined)).toBe(false);
    expect(isId(42)).toBe(false);
    expect(isId({})).toBe(false);
    expect(isId(['id'])).toBe(false);
  });
});

describe('clampInt', () => {
  it('clamps numerics into range and truncates fractions', () => {
    expect(clampInt('25', 20, 1, 40)).toBe(25);
    expect(clampInt(999, 20, 1, 40)).toBe(40);
    expect(clampInt(-3, 20, 1, 40)).toBe(1);
    expect(clampInt('7.9', 20, 1, 40)).toBe(7);
  });
  it('returns the fallback for non-numeric input (undefined stays undefined)', () => {
    expect(clampInt('abc', 20, 1, 40)).toBe(20);
    expect(clampInt(NaN, 20, 1, 40)).toBe(20);
    expect(clampInt(Infinity, 20, 1, 40)).toBe(20);
    expect(clampInt(undefined, undefined, 1, Number.MAX_SAFE_INTEGER)).toBe(undefined);
    expect(clampInt({}, 10, 1, 40)).toBe(10);
  });
});

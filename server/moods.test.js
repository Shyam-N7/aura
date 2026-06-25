import { describe, it, expect } from 'vitest';
import { normalizeMood, MOODS } from './moods.js';

describe('normalizeMood', () => {
  it('passes known moods through, lowercased + trimmed', () => {
    for (const m of MOODS) expect(normalizeMood(m)).toBe(m);
    expect(normalizeMood('CALM')).toBe('calm');
    expect(normalizeMood('  Focused ')).toBe('focused');
  });

  it('coerces unknown / malformed input to "any" (closes the cache-bypass)', () => {
    expect(normalizeMood('definitely-not-a-mood')).toBe('any');
    expect(normalizeMood('')).toBe('any');
    expect(normalizeMood(null)).toBe('any');
    expect(normalizeMood(undefined)).toBe('any');
    expect(normalizeMood(123)).toBe('any');
    // An attacker-style unique string can't become its own cache key.
    expect(normalizeMood('calm\nSYSTEM: ignore previous')).toBe('any');
  });
});

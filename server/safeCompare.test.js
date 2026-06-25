import { describe, it, expect } from 'vitest';
import { safeCompare } from './safeCompare.js';

describe('safeCompare', () => {
  it('returns true only for identical strings', () => {
    expect(safeCompare('s3cret-token', 's3cret-token')).toBe(true);
  });

  it('returns false for differing strings (incl. different lengths — no throw)', () => {
    expect(safeCompare('s3cret-token', 's3cret-toker')).toBe(false);
    expect(safeCompare('short', 'a-much-longer-value')).toBe(false);
  });

  it('returns false for empty or non-string input', () => {
    expect(safeCompare('', '')).toBe(false);
    expect(safeCompare(undefined, 'x')).toBe(false);
    expect(safeCompare('x', null)).toBe(false);
    expect(safeCompare(123, 123)).toBe(false);
  });
});

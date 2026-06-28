import { describe, it, expect } from 'vitest';
import { levelGainFor, dbToGain } from './eqConfig';

describe('levelGainFor (loudness leveling)', () => {
  const opts = { target: 0.16, minDb: -9, maxDb: 9 };

  it('returns null for silence (no adjustment)', () => {
    expect(levelGainFor(0, opts)).toBeNull();
    expect(levelGainFor(1e-5, opts)).toBeNull();
  });

  it('boosts a quiet program, clamped to +maxDb', () => {
    expect(levelGainFor(0.02, opts)).toBeCloseTo(dbToGain(9), 5);   // 8x wanted → clamped
  });

  it('attenuates a hot program, clamped to -|minDb|', () => {
    expect(levelGainFor(0.8, opts)).toBeCloseTo(dbToGain(-9), 5);   // 0.2x wanted → clamped
  });

  it('leaves a near-target program ~unity', () => {
    expect(levelGainFor(0.16, opts)).toBeCloseTo(1, 5);
  });
});

import { describe, it, expect } from 'vitest';
import { fmtTime } from './fmtTime';

describe('fmtTime', () => {
  it('formats whole minutes as M:00', () => {
    expect(fmtTime(60)).toBe('1:00');
    expect(fmtTime(180)).toBe('3:00');
  });

  it('zero-pads seconds under 10', () => {
    expect(fmtTime(65)).toBe('1:05');
    expect(fmtTime(9)).toBe('0:09');
  });

  it('floors fractional seconds', () => {
    expect(fmtTime(254.9)).toBe('4:14');
    expect(fmtTime(0.5)).toBe('0:00');
  });

  it('clamps negative inputs to 0:00', () => {
    expect(fmtTime(-10)).toBe('0:00');
  });
});

import { describe, it, expect } from 'vitest';
import { fmtTime, fmtRuntime } from './fmtTime';

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

describe('fmtRuntime', () => {
  it('shows minutes under an hour', () => {
    expect(fmtRuntime(0)).toBe('0 min');
    expect(fmtRuntime(48 * 60)).toBe('48 min');
    expect(fmtRuntime(59 * 60 + 29)).toBe('59 min');  // rounds to nearest minute
  });

  it('shows whole hours with no trailing minutes', () => {
    expect(fmtRuntime(60 * 60)).toBe('1 hr');
    expect(fmtRuntime(3 * 60 * 60)).toBe('3 hr');
  });

  it('shows hours and minutes together', () => {
    expect(fmtRuntime(60 * 60 + 24 * 60)).toBe('1 hr 24 min');
    expect(fmtRuntime(5 * 60 * 60 + 12 * 60)).toBe('5 hr 12 min');
  });

  it('clamps negative inputs to 0 min', () => {
    expect(fmtRuntime(-10)).toBe('0 min');
  });
});

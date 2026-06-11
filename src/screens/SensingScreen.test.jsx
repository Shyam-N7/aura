import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SensingScreen } from './SensingScreen';

// Minimal theme that satisfies the props SensingScreen reads via theme.* — but
// after the Tailwind migration the only theme-prop value actually consumed is
// theme.accent (for the inline BreathingDot color and shadow). Anything else
// is read from CSS vars, not props.
const theme = {
  bg: '#e9dfd1',
  ink: '#2a221c',
  inkSoft: 'rgba(0,0,0,0.6)',
  inkFaint: 'rgba(0,0,0,0.3)',
  accent: '#b06a3f',
  accentSoft: 'rgba(176,106,63,0.16)',
  stageBg: 'linear-gradient(140deg,#d9cdb9,#bca790)',
};

describe('SensingScreen', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the sensing header immediately', () => {
    render(<SensingScreen djName="AURA" mood="calm" theme={theme} onReady={() => {}}/>);
    expect(screen.getByText(/sensing/i)).toBeInTheDocument();
  });

  it('reveals each scripted line on its timer', () => {
    // First scripted line is the current timestamp (e.g. "MONDAY · 9:47 PM").
    // Match the live-stamp shape rather than a hardcoded weekday/time.
    const STAMP_RE = /^(SUN|MON|TUES|WEDNES|THURS|FRI|SATUR)DAY · \d{1,2}:\d{2} (AM|PM)$/;
    render(<SensingScreen djName="AURA" mood="calm" theme={theme} onReady={() => {}}/>);
    expect(screen.queryByText(STAMP_RE)).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText(STAMP_RE)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Reading the moment')).toBeInTheDocument();
  });

  it('calls onReady ~5.9s after mount', () => {
    const onReady = vi.fn();
    render(<SensingScreen djName="AURA" mood="calm" theme={theme} onReady={onReady}/>);
    act(() => { vi.advanceTimersByTime(5800); });
    expect(onReady).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

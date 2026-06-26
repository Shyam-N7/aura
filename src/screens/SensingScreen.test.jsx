import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// The intro fetches mood + top-artist best-effort; stub both so the test is
// deterministic and never touches the network. Mood never resolves (snapshot
// stays null → falls back to the `mood` prop); top-artists is empty (no recap →
// the time-of-day fallback line shows).
vi.mock('../api/mood', () => ({ getCurrentMood: vi.fn(() => new Promise(() => {})) }));
vi.mock('../api/stats', () => ({ getTopArtists: vi.fn(() => Promise.resolve([])) }));

import { SensingScreen } from './SensingScreen';

describe('SensingScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix the clock so partOfDay() ('evening') and thus the greeting are stable.
    vi.setSystemTime(new Date('2026-06-26T20:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the sensing header immediately', () => {
    render(<SensingScreen name="Shyam" mood="calm" onReady={() => {}}/>);
    expect(screen.getByText(/^sensing$/)).toBeInTheDocument();
  });

  it('opens with a personalised greeting (first name + time of day)', () => {
    render(<SensingScreen name="Shyam Nair" mood="calm" onReady={() => {}}/>);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText('Good evening, Shyam')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Reading the moment')).toBeInTheDocument();
  });

  it('falls back to a plain greeting when no name is provided', () => {
    render(<SensingScreen mood="calm" onReady={() => {}}/>);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText('Good evening')).toBeInTheDocument();
  });

  it('calls onReady ~5.9s after mount', () => {
    const onReady = vi.fn();
    render(<SensingScreen name="Shyam" mood="calm" onReady={onReady}/>);
    act(() => { vi.advanceTimersByTime(5800); });
    expect(onReady).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('skips straight to onReady on tap', () => {
    const onReady = vi.fn();
    render(<SensingScreen name="Shyam" mood="calm" onReady={onReady}/>);
    fireEvent.click(screen.getByRole('button', { name: /skip intro/i }));
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

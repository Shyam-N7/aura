import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TapHint } from './TapHint';
import { killHint, _resetHintBus } from '../lib/tapHint';

beforeEach(() => {
  localStorage.clear();
  _resetHintBus();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const hint = () => document.querySelector('.aura-taphint');

describe('TapHint', () => {
  it('stays hidden through the delay, then shows as a decorative element', () => {
    render(<TapHint id="t1" label="tap to open" delayMs={2400}/>);
    expect(hint()).toBeNull();
    act(() => vi.advanceTimersByTime(2500));
    expect(hint()).not.toBeNull();
    expect(hint().getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('tap to open')).toBeInTheDocument();
  });

  it('never shows again once killed, across remounts', () => {
    killHint('t2');
    render(<TapHint id="t2" delayMs={100}/>);
    act(() => vi.advanceTimersByTime(500));
    expect(hint()).toBeNull();
  });

  it('hides immediately when show flips off', () => {
    const { rerender } = render(<TapHint id="t3" delayMs={100} show/>);
    act(() => vi.advanceTimersByTime(200));
    expect(hint()).not.toBeNull();
    rerender(<TapHint id="t3" delayMs={100} show={false}/>);
    expect(hint()).toBeNull();
  });

  it('yields when another hint holds the claim', () => {
    render(<TapHint id="first" delayMs={100}/>);
    render(<TapHint id="second" delayMs={100}/>);
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelectorAll('.aura-taphint')).toHaveLength(1);
  });

  it('takes its turn when the holder is killed', () => {
    const { rerender } = render(<TapHint id="fab" label="quick actions" delayMs={100}/>);
    render(<TapHint id="shelf" label="tap to open" delayMs={100}/>);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('quick actions')).toBeInTheDocument();
    expect(screen.queryByText('tap to open')).toBeNull();
    // the host's real handler kills the hint and flips show off in one tick
    act(() => killHint('fab'));
    rerender(<TapHint id="fab" label="quick actions" delayMs={100} show={false}/>);
    expect(screen.queryByText('quick actions')).toBeNull();
    expect(screen.getByText('tap to open')).toBeInTheDocument();
  });

  it('retires after autoHideMs and hands the slot to the waiter', () => {
    render(<TapHint id="fab" label="quick actions" delayMs={100} autoHideMs={8000}/>);
    render(<TapHint id="shelf" label="tap to open" delayMs={100} autoHideMs={8000}/>);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('quick actions')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.queryByText('quick actions')).toBeNull();
    expect(screen.getByText('tap to open')).toBeInTheDocument();
  });
});

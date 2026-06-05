import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobilePlayer } from './MobilePlayer';

const track = { id: 't1', title: 'Midnight Drive', artist: 'Veridian', durationSec: 200, cover: 'rings' };

function setup(props = {}) {
  const handlers = {
    onTogglePlay: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(), onSeek: vi.fn(),
    onCycleRepeat: vi.fn(), onShuffle: vi.fn(), onBack: vi.fn(),
    openWhy: vi.fn(), openLyrics: vi.fn(), openQueue: vi.fn(),
  };
  render(<MobilePlayer track={track} progress={0.25} playing={false} mood="calm" djName="AURA" {...handlers} {...props}/>);
  return handlers;
}

describe('MobilePlayer', () => {
  it('renders the track title and artist', () => {
    setup();
    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
    expect(screen.getByText('Veridian')).toBeInTheDocument();
  });

  it('shows a play affordance when paused and fires onTogglePlay', () => {
    const h = setup({ playing: false });
    fireEvent.click(screen.getByLabelText('play'));
    expect(h.onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('shows a pause affordance when playing', () => {
    setup({ playing: true });
    expect(screen.getByLabelText('pause')).toBeInTheDocument();
  });

  it('fires prev / next from the transport', () => {
    const h = setup();
    fireEvent.click(screen.getByLabelText('previous'));
    fireEvent.click(screen.getByLabelText('next'));
    expect(h.onPrev).toHaveBeenCalledTimes(1);
    expect(h.onNext).toHaveBeenCalledTimes(1);
  });

  it('exposes like and add-to-playlist actions on the surface', () => {
    setup();
    expect(screen.getByLabelText('like')).toBeInTheDocument();
    expect(screen.getByLabelText('add to playlist')).toBeInTheDocument();
  });

  it('opens the queue from the actions row', () => {
    const h = setup();
    fireEvent.click(screen.getByLabelText('up next'));
    expect(h.openQueue).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { DesktopBridges } from './DesktopBridges';
import { getBridge, getBridgeSuggestion } from '../../api/bridges';

vi.mock('../../api/bridges', () => ({
  getBridge: vi.fn(),
  getBridgeSuggestion: vi.fn(),
}));
vi.mock('../../lib/toast', () => ({ toast: vi.fn() }));

const SUGGESTION = {
  from: 'restless', to: 'focused', steps: 5, mood: 'restless', confidence: 0.8,
  reason: 'reading you as restless tonight — lots of skips through anirudh. this bridge settles you into focus.',
  langs: ['tamil'],
};
const TRACKS = Array.from({ length: 5 }, (_, i) => ({
  id: `t${i}`, title: `Track ${i}`, artist: 'A', streamUrl: 'u', imageUrl: 'img', stepLabel: `s${i}`,
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  getBridgeSuggestion.mockResolvedValue(SUGGESTION);
  getBridge.mockResolvedValue({ narrative: 'a slow walk into focus.', tracks: TRACKS });
});

describe('DesktopBridges v2', () => {
  it('arrives already knowing: hero reason + background-prefetched build', async () => {
    render(<DesktopBridges/>);
    expect(screen.getByText('the bridge already knows')).toBeInTheDocument();
    expect(await screen.findByText(/reading you as restless tonight/)).toBeInTheDocument();
    await waitFor(() => expect(getBridge).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'restless', to: 'focused', steps: 5, langs: ['tamil'] }),
    ));
    expect(await screen.findByText('a slow walk into focus.')).toBeInTheDocument();
  });

  it('begins the hero bridge with the journey as the queue label', async () => {
    const onPickSequence = vi.fn();
    render(<DesktopBridges onPickSequence={onPickSequence}/>);
    // Preset cards contain "begin →" spans; only the itinerary CTA is a button
    // whose accessible name is exactly that.
    const begin = await screen.findByRole('button', { name: 'begin →' });
    fireEvent.click(begin);
    expect(onPickSequence).toHaveBeenCalledWith(TRACKS, 0, 'restless → focused', expect.anything());
  });

  it('hides the hero when there is no read', async () => {
    getBridgeSuggestion.mockRejectedValue(new Error('no auth'));
    render(<DesktopBridges/>);
    await waitFor(() =>
      expect(screen.queryByText('the bridge already knows')).toBeNull());
    expect(screen.getByText('build your own')).toBeInTheDocument();
  });

  it('language chips: your mix default, max two picks, third replaces oldest', async () => {
    render(<DesktopBridges/>);
    const mix = screen.getByText('your mix');
    expect(mix.className).toContain('--on');
    fireEvent.click(screen.getByText('tamil'));
    expect(mix.className).not.toContain('--on');
    fireEvent.click(screen.getByText('english'));
    fireEvent.click(screen.getByText('hindi'));   // third pick → tamil drops
    expect(screen.getByText('tamil').className).not.toContain('--on');
    expect(screen.getByText('english').className).toContain('--on');
    expect(screen.getByText('hindi').className).toContain('--on');
    fireEvent.click(mix);
    expect(mix.className).toContain('--on');
    expect(screen.getByText('english').className).not.toContain('--on');
  });

  it('builder is two-phase: curate fills the itinerary, then begin plays it', async () => {
    const onPickSequence = vi.fn();
    render(<DesktopBridges onPickSequence={onPickSequence}/>);
    await screen.findByText('a slow walk into focus.');   // let the hero settle first
    fireEvent.click(screen.getByRole('button', { name: 'curate this path →' }));
    await waitFor(() => expect(getBridge).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'sad', to: 'happy', steps: 5, langs: [] }),
    ));
    // Two itinerary CTAs now exist (hero + builder); the builder's is last in DOM.
    const begins = await screen.findAllByRole('button', { name: 'begin →' });
    fireEvent.click(begins[begins.length - 1]);
    expect(onPickSequence).toHaveBeenCalledWith(TRACKS, 0, 'sad → happy', expect.anything());
  });

  it('marks the FROM chip the engine read you as', async () => {
    const { container } = render(<DesktopBridges/>);
    const badge = await waitFor(() => {
      const el = container.querySelector('.aura-dbr__moodchip-badge');
      if (!el) throw new Error('badge not yet rendered');
      return el;
    });
    expect(badge.closest('button').textContent).toContain('restless');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingScreen } from './OnboardingScreen';

// getDiscoverHome runs on mount; resolve it empty so the screen falls back to
// the `pool` prop for the artist grid. The onboarding lib is mocked so we can
// assert the seed payload submitted at the end.
vi.mock('../api/discover', () => ({
  getDiscoverHome: vi.fn(() => Promise.resolve({ trending: [] })),
}));
vi.mock('../api/artists', () => ({
  getArtist: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../lib/onboarding', () => ({
  setSeedArtists: vi.fn(),
  setSeedSignals: vi.fn(),
  markOnboarded: vi.fn(),
}));

import { setSeedArtists, setSeedSignals, markOnboarded } from '../lib/onboarding';

// Three English artists so a single language pick keeps them in the filtered
// grid (tiles with a non-matching language are dropped on the artist step).
const POOL = [
  { id: 't1', artist: 'Alpha',   language: 'english', imageUrl: null },
  { id: 't2', artist: 'Bravo',   language: 'english', imageUrl: null },
  { id: 't3', artist: 'Charlie', language: 'english', imageUrl: null },
];

const next   = () => screen.getByRole('button', { name: /next/i });
const finish = () => screen.getByRole('button', { name: /get started/i });
const tile   = (name) => screen.getByText(name).closest('button');

describe('OnboardingScreen (stepper)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('gates each step and only finishes after all three are satisfied', async () => {
    const onDone = vi.fn();
    render(<OnboardingScreen pool={POOL} onDone={onDone}/>);
    // findBy flushes the getDiscoverHome effect before we assert.
    await screen.findByRole('button', { name: 'English' });

    // Step 1 — language required to advance.
    expect(screen.getByText('What languages do you listen to?')).toBeInTheDocument();
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(next()).toBeEnabled();
    fireEvent.click(next());

    // Step 2 — mood required.
    expect(screen.getByText('How do you feel?')).toBeInTheDocument();
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Focus/i }));
    expect(next()).toBeEnabled();
    fireEvent.click(next());

    // Step 3 — at least three artists required (no upper cap).
    expect(screen.getByText('Pick three or more artists you love.')).toBeInTheDocument();
    expect(finish()).toBeDisabled();
    fireEvent.click(tile('Alpha'));
    fireEvent.click(tile('Bravo'));
    expect(finish()).toBeDisabled();           // only two picked
    fireEvent.click(tile('Charlie'));
    expect(finish()).toBeEnabled();            // three picked
    fireEvent.click(tile('Charlie'));          // toggling off drops back below the minimum
    expect(finish()).toBeDisabled();
    fireEvent.click(tile('Charlie'));          // re-add → enabled again

    fireEvent.click(finish());
    expect(setSeedSignals).toHaveBeenCalledWith({ languages: ['english'], mood: 'focused' });
    expect(setSeedArtists).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'Alpha' })]),
    );
    expect(markOnboarded).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Back returns to the previous step with the selection intact', async () => {
    render(<OnboardingScreen pool={POOL} onDone={vi.fn()}/>);
    await screen.findByRole('button', { name: 'English' });

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    fireEvent.click(next());
    expect(screen.getByText('How do you feel?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('What languages do you listen to?')).toBeInTheDocument();
    // English is still selected, so Next is immediately enabled again.
    expect(next()).toBeEnabled();
  });
});

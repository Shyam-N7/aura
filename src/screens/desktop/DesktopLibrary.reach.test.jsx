import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesktopLibrary } from './DesktopLibrary';

// The playlists shelf is the ONLY route to the playlists screen, and the
// playlists screen holds both "New playlist" and "Import from YouTube". Its
// footer used to require `playlists?.length > 0`, so an account that owned
// nothing had no way to reach either — the one state where starting a playlist
// matters most was the one state with no door. (DesktopHome has the same shape,
// so there was no second way in.)
//
// This pins the door open.

vi.mock('../../api/library', () => ({
  getLibrarySummary: vi.fn(() => Promise.resolve({})),
  getLikedTracks:    vi.fn(() => Promise.resolve([])),
  getHistory:        vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../api/playlists', () => ({
  listPlaylists: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: { id: 'u1', name: 'Test' } }),
}));

import { listPlaylists } from '../../api/playlists';

// Targeted by aria-controls: the shelf title appears in both the toggle button
// and the region's aria-label, so a text query matches two nodes.
const openShelf = async () => {
  const toggle = await waitFor(() => {
    const el = document.querySelector('[aria-controls="shelf-playlists"]');
    if (!el) throw new Error('playlists shelf not rendered');
    return el;
  });
  fireEvent.click(toggle);
};

beforeEach(() => {
  vi.clearAllMocks();
  try { sessionStorage.clear(); } catch { /* jsdom */ }
});

describe('an account that owns nothing', () => {
  it('can still reach the playlists screen', async () => {
    listPlaylists.mockResolvedValue([]);
    const onOpenPlaylists = vi.fn();
    render(<DesktopLibrary onOpenPlaylists={onOpenPlaylists} t={{}} setTweak={vi.fn()}/>);
    await openShelf();

    const cta = await screen.findByText('NEW PLAYLIST →');
    fireEvent.click(cta);
    expect(onOpenPlaylists).toHaveBeenCalled();
  });

  it('labels the way in as starting something, not browsing nothing', async () => {
    // "SEE ALL" over an empty list reads as a bug.
    listPlaylists.mockResolvedValue([]);
    render(<DesktopLibrary onOpenPlaylists={vi.fn()} t={{}} setTweak={vi.fn()}/>);
    await openShelf();
    expect(await screen.findByText('NEW PLAYLIST →')).toBeInTheDocument();
    expect(screen.queryByText('SEE ALL →')).not.toBeInTheDocument();
  });
});

describe('an account that owns playlists', () => {
  it('still says SEE ALL, and still navigates', async () => {
    listPlaylists.mockResolvedValue([
      { id: 'pl_1', name: 'road trip', trackCount: 9, coverImageUrl: null },
    ]);
    const onOpenPlaylists = vi.fn();
    render(<DesktopLibrary onOpenPlaylists={onOpenPlaylists} t={{}} setTweak={vi.fn()}/>);
    await openShelf();

    const cta = await screen.findByText('SEE ALL →');
    fireEvent.click(cta);
    expect(onOpenPlaylists).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('road trip')).toBeInTheDocument());
  });
});

describe('when the host gives no handler', () => {
  it('renders no dead button', async () => {
    listPlaylists.mockResolvedValue([]);
    render(<DesktopLibrary t={{}} setTweak={vi.fn()}/>);
    await openShelf();
    expect(screen.queryByText('NEW PLAYLIST →')).not.toBeInTheDocument();
    expect(screen.queryByText('SEE ALL →')).not.toBeInTheDocument();
  });
});

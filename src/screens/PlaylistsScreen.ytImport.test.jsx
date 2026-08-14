import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PlaylistsScreen } from './PlaylistsScreen';

// PlaylistsScreen is a PRODUCTION screen that predates this feature, and the
// import entry point is the only change made to it. So the thing worth testing
// is not that the button works — it is that with the feature off, this screen
// is exactly what it was before. That is the check standing between a
// half-configured deployment and a broken library page.

vi.mock('../api/playlists', () => ({
  listPlaylists: vi.fn(() => Promise.resolve([])),
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  acceptPlaylistInvite: vi.fn(),
  removePlaylistCollaborator: vi.fn(),
  listSavedPlaylists: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../api/autoPlaylists', () => ({ listAutoPlaylists: vi.fn(() => Promise.resolve([])) }));
vi.mock('../api/ytImport', async (importOriginal) => ({
  ...(await importOriginal()),
  getFeatures: vi.fn(),
  previewLink: vi.fn(),
  pollImport: vi.fn(() => new Promise(() => {})),
}));

import { getFeatures } from '../api/ytImport';

beforeEach(() => vi.clearAllMocks());

describe('with YOUTUBE_API_KEY unset', () => {
  it('shows no import entry point at all', async () => {
    getFeatures.mockResolvedValue({ youtubeImport: false });
    render(<PlaylistsScreen onClose={vi.fn()}/>);

    // The existing screen still works, unchanged.
    await waitFor(() => expect(screen.getByText('New playlist')).toBeInTheDocument());
    expect(screen.queryByText('Import from YouTube')).not.toBeInTheDocument();
  });

  it('shows nothing when the capability check itself fails', async () => {
    // getFeatures never throws — it resolves empty — and an absent flag must
    // read as "off". Failing in the other direction would put a button on every
    // deployment that then 503s.
    getFeatures.mockResolvedValue({});
    render(<PlaylistsScreen onClose={vi.fn()}/>);
    await waitFor(() => expect(screen.getByText('New playlist')).toBeInTheDocument());
    expect(screen.queryByText('Import from YouTube')).not.toBeInTheDocument();
  });
});

describe('with the key set', () => {
  it('offers the entry point beside New playlist', async () => {
    getFeatures.mockResolvedValue({ youtubeImport: true });
    render(<PlaylistsScreen onClose={vi.fn()}/>);
    await waitFor(() => expect(screen.getByText('Import from YouTube')).toBeInTheDocument());
    expect(screen.getByText('New playlist')).toBeInTheDocument();
  });

  it('opens the import screen in place, without routing away', async () => {
    getFeatures.mockResolvedValue({ youtubeImport: true });
    render(<PlaylistsScreen onClose={vi.fn()}/>);
    await waitFor(() => screen.getByText('Import from YouTube'));
    fireEvent.click(screen.getByText('Import from YouTube'));
    await waitFor(() => expect(screen.getByPlaceholderText(/paste a youtube/i)).toBeInTheDocument());
  });
});

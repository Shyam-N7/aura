import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../api/playlists', () => ({
  getPlaylist: vi.fn(),
  getPlaylistRev: vi.fn().mockResolvedValue({ updatedAt: 1 }),
  removeFromPlaylist: vi.fn(),
  createPlaylistInvite: vi.fn(),
  setPlaylistVisibility: vi.fn(),
  removePlaylistCollaborator: vi.fn().mockResolvedValue(undefined),
  setPlaylistOnlyMe: vi.fn().mockResolvedValue({ isPublic: false, onlyMe: true }),
}));
vi.mock('../../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../lib/confirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/trackContextMenu', () => ({ toggleTrackMenu: vi.fn() }));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ id: 'me' }) }));

import { getPlaylist, removePlaylistCollaborator, setPlaylistOnlyMe } from '../../api/playlists';
import { confirm } from '../../lib/confirm';
import { DesktopPlaylistDetail } from './DesktopPlaylistDetail';

const view = (over = {}) => ({
  id: 'pl1', name: 'Road Trip', description: null, trackCount: 1,
  role: 'owner', canEdit: true, shared: true, ownerName: 'shyam',
  updatedAt: Date.now() - 3 * 3600 * 1000,
  isPublic: false, publicId: null,
  collaborators: [
    { userId: 'u2', name: 'ravi', role: 'editor' },
    { userId: 'u3', name: 'meera', role: 'viewer' },
  ],
  tracks: [
    { id: 't1', title: 'Song One', artist: 'A', durationSec: 200, addedBy: { userId: 'u2', name: 'ravi' } },
    { id: 't2', title: 'Song Two', artist: 'B', durationSec: 200, addedBy: { userId: 'me', name: 'shyam' } },
  ],
  ...over,
});

const renderDetail = async (data = view()) => {
  getPlaylist.mockResolvedValue(data);
  await act(async () => {
    render(<DesktopPlaylistDetail playlistId="pl1" onClose={vi.fn()} onPlaySequence={vi.fn()}/>);
  });
};

beforeEach(() => vi.clearAllMocks());

describe('DesktopPlaylistDetail — collaborators', () => {
  it('renders an avatar cluster + a names caption', async () => {
    await renderDetail();
    expect(await screen.findByText('ravi, meera')).toBeInTheDocument();   // caption
    expect(screen.getByTitle('remove ravi')).toBeInTheDocument();          // owner-removable circle
    expect(screen.getByTitle('remove meera')).toBeInTheDocument();
    expect(screen.getByText(/updated 3h ago/)).toBeInTheDocument();
  });

  it('lets the owner remove a collaborator (confirm → API → circle gone)', async () => {
    await renderDetail();
    await act(async () => { fireEvent.click(screen.getByTitle('remove ravi')); });
    expect(confirm).toHaveBeenCalled();
    expect(removePlaylistCollaborator).toHaveBeenCalledWith('pl1', 'u2');
    // ravi gone → the single remaining collaborator's caption shows their role.
    await vi.waitFor(() => expect(screen.queryByTitle('remove ravi')).not.toBeInTheDocument());
    expect(screen.getByText('meera · can view')).toBeInTheDocument();
  });

  it('shows non-owner circles as read-only (no remove)', async () => {
    await renderDetail(view({ role: 'viewer', canEdit: false }));
    const av = (await screen.findByTitle('ravi · can edit')).closest('button');
    expect(av).toBeDisabled();
    fireEvent.click(av);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('DesktopPlaylistDetail — attribution & visibility', () => {
  it('attributes each track — a name for others, "you" for yours', async () => {
    await renderDetail();
    expect(await screen.findByText('added by ravi')).toBeInTheDocument();
    expect(screen.getByText('added by you')).toBeInTheDocument();   // userId 'me'
  });

  it('does not attribute tracks on a solo (unshared) playlist', async () => {
    await renderDetail(view({ shared: false, collaborators: [] }));
    await screen.findByText('Song One');
    expect(screen.queryByText(/added by/)).not.toBeInTheDocument();
  });

  it('"only you" confirms then hard-revokes sharing', async () => {
    await renderDetail();
    fireEvent.click(await screen.findByText('Share'));
    await act(async () => { fireEvent.click(screen.getByText('only you')); });
    expect(confirm).toHaveBeenCalled();
    expect(setPlaylistOnlyMe).toHaveBeenCalledWith('pl1');
    await vi.waitFor(() => expect(screen.queryByText('ravi, meera')).not.toBeInTheDocument());
  });
});

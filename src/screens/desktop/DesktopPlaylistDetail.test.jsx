import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../api/playlists', () => ({
  getPlaylist: vi.fn(),
  getPlaylistRev: vi.fn().mockResolvedValue({ updatedAt: 1 }),
  removeFromPlaylist: vi.fn(),
  createPlaylistInvite: vi.fn(),
  setPlaylistVisibility: vi.fn(),
  removePlaylistCollaborator: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../lib/confirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/trackContextMenu', () => ({ openTrackMenu: vi.fn() }));

import { getPlaylist, removePlaylistCollaborator } from '../../api/playlists';
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
  tracks: [{ id: 't1', title: 'Song One', artist: 'A', durationSec: 200 }],
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
  it('renders a chip per collaborator with name + role', async () => {
    await renderDetail();
    expect(await screen.findByText('ravi')).toBeInTheDocument();
    expect(screen.getByText('meera')).toBeInTheDocument();
    expect(screen.getByText('can edit')).toBeInTheDocument();
    expect(screen.getByText('can view')).toBeInTheDocument();
    expect(screen.getByText(/updated 3h ago/)).toBeInTheDocument();
  });

  it('lets the owner remove a collaborator (confirm → API → chip gone)', async () => {
    await renderDetail();
    await act(async () => { fireEvent.click(screen.getByText('ravi')); });
    expect(confirm).toHaveBeenCalled();
    expect(removePlaylistCollaborator).toHaveBeenCalledWith('pl1', 'u2');
    await vi.waitFor(() => expect(screen.queryByText('ravi')).not.toBeInTheDocument());
    expect(screen.getByText('meera')).toBeInTheDocument();   // the other stays
  });

  it('shows non-owner chips as read-only (no remove)', async () => {
    await renderDetail(view({ role: 'viewer', canEdit: false }));
    const chip = (await screen.findByText('ravi')).closest('button');
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(confirm).not.toHaveBeenCalled();
  });
});

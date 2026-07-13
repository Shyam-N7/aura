import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

vi.mock('../../api/playlists', () => ({
  getPlaylist: vi.fn(),
  getPlaylistRev: vi.fn().mockResolvedValue({ updatedAt: 1 }),
  removeFromPlaylist: vi.fn(),
  createPlaylistInvite: vi.fn(),
  setPlaylistVisibility: vi.fn(),
  removePlaylistCollaborator: vi.fn().mockResolvedValue(undefined),
  setPlaylistOnlyMe: vi.fn().mockResolvedValue({ isPublic: false, onlyMe: true }),
  setPlaylistCover: vi.fn().mockResolvedValue({ coverImageUrl: 'img-t1' }),
}));
vi.mock('../../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../lib/confirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/trackContextMenu', () => ({ toggleTrackMenu: vi.fn() }));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ id: 'me' }) }));
vi.mock('../../api/uploads', () => ({ uploadImage: vi.fn().mockResolvedValue({ url: 'https://x.public.blob.vercel-storage.com/cover/me-1.jpg' }) }));

import { getPlaylist, removePlaylistCollaborator, setPlaylistOnlyMe, setPlaylistCover } from '../../api/playlists';
import { uploadImage } from '../../api/uploads';
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

let lastRender;
const renderDetail = async (data = view()) => {
  getPlaylist.mockResolvedValue(data);
  await act(async () => {
    lastRender = render(<DesktopPlaylistDetail playlistId="pl1" onClose={vi.fn()} onPlaySequence={vi.fn()}/>);
  });
  return lastRender;
};

beforeEach(() => vi.clearAllMocks());

describe('DesktopPlaylistDetail — collaborators', () => {
  it('renders an avatar cluster + a names caption, and opens the members sheet', async () => {
    await renderDetail();
    expect(await screen.findByText('ravi, meera')).toBeInTheDocument();   // caption
    expect(screen.getByText(/updated 3h ago/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('who has access'));
    const sheet = screen.getByRole('dialog', { name: 'who has access' });
    expect(within(sheet).getByText('owner')).toBeInTheDocument();          // the owner is listed
    expect(within(sheet).getByText('ravi')).toBeInTheDocument();
    expect(within(sheet).getByText('can edit')).toBeInTheDocument();
    expect(within(sheet).getByText('can view')).toBeInTheDocument();
  });

  it('lets the owner remove a collaborator from the sheet (confirm → API → gone)', async () => {
    await renderDetail();
    fireEvent.click(await screen.findByLabelText('who has access'));
    const raviRow = screen.getByText('ravi').closest('.aura-dpd__member');
    await act(async () => { fireEvent.click(within(raviRow).getByText('remove')); });
    expect(confirm).toHaveBeenCalled();
    expect(removePlaylistCollaborator).toHaveBeenCalledWith('pl1', 'u2');
    await vi.waitFor(() => expect(screen.queryByText('ravi')).not.toBeInTheDocument());
    expect(screen.getByText('meera')).toBeInTheDocument();   // the other stays
  });

  it('shows non-owner members read-only (no remove buttons)', async () => {
    await renderDetail(view({ role: 'viewer', canEdit: false }));
    fireEvent.click(await screen.findByLabelText('who has access'));
    const sheet = screen.getByRole('dialog', { name: 'who has access' });
    expect(within(sheet).getByText('ravi')).toBeInTheDocument();
    expect(within(sheet).queryByText('remove')).toBeNull();
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

  it('lets the owner change the cover from the track picker', async () => {
    await renderDetail();
    fireEvent.click(await screen.findByText('change cover'));
    expect(screen.getByRole('dialog', { name: 'choose a cover' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTitle('Song One')); });
    expect(setPlaylistCover).toHaveBeenCalledWith('pl1', { trackId: 't1' });
  });

  it('uploads a custom cover image and sets it', async () => {
    const { container } = await renderDetail();
    fireEvent.click(await screen.findByText('change cover'));
    const input = container.querySelector('input[type="file"]');
    const file = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    expect(uploadImage).toHaveBeenCalledWith(file, { kind: 'cover' });
    expect(setPlaylistCover).toHaveBeenCalledWith('pl1', { imageUrl: 'https://x.public.blob.vercel-storage.com/cover/me-1.jpg' });
  });

  it('the share button wears the current visibility — "Shared" here, then "Private" after revoke', async () => {
    await renderDetail();
    expect(await screen.findByText('Shared')).toBeInTheDocument();   // has collaborators
    fireEvent.click(screen.getByText('Shared'));
    await act(async () => { fireEvent.click(screen.getByText('only you')); });
    expect(confirm).toHaveBeenCalled();
    expect(setPlaylistOnlyMe).toHaveBeenCalledWith('pl1');
    await vi.waitFor(() => expect(screen.queryByText('ravi, meera')).not.toBeInTheDocument());
    expect(screen.getByText('Private')).toBeInTheDocument();          // button now reflects private
  });

  it('a public playlist shows "Public"; a plain private one shows "Private"', async () => {
    const { unmount } = await renderDetail(view({ isPublic: true, publicId: 'pub1' }));
    expect(await screen.findByText('Public')).toBeInTheDocument();
    unmount();
    await renderDetail(view({ collaborators: [], shared: false }));
    expect(await screen.findByText('Private')).toBeInTheDocument();
  });
});

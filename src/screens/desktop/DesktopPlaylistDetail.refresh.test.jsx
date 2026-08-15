import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesktopPlaylistDetail } from './DesktopPlaylistDetail';

// Refresh was BUILT AND UNREACHABLE — refreshPlaylist and listLinks existed on
// the server, were exposed in the API client, and were tested, while being
// called from no component at all. The copy pack proved it: every COPY section
// had uses except `refresh`, which had zero.
//
// So the thing worth pinning is not that refresh works — that was already
// covered — but that it is REACHABLE from exactly the right playlists and
// invisible everywhere else. A refresh button on a playlist that did not come
// from YouTube is worse than no button.

vi.mock('../../api/playlists', () => ({
  getPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  getPlaylistRev: vi.fn(() => Promise.resolve({ rev: 1 })),
  createPlaylistInvite: vi.fn(),
  setPlaylistVisibility: vi.fn(),
  removePlaylistCollaborator: vi.fn(),
  setPlaylistOnlyMe: vi.fn(),
  setPlaylistCover: vi.fn(),
}));
vi.mock('../../api/uploads', () => ({ uploadImage: vi.fn() }));
vi.mock('../../api/ytImport', () => ({
  getYtLink: vi.fn(),
  getFeatures: vi.fn(),
  refreshPlaylist: vi.fn(),
  // useImportJob is mocked below, but the module still resolves these.
  pollImport: vi.fn(),
  isLive: (s) => ['queued', 'fetching', 'matching'].includes(s),
  invalidateYtLinks: vi.fn(),
}));
vi.mock('../../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../lib/confirm', () => ({ confirm: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  getUser: () => ({ id: 'u1', name: 'Me' }),
}));

import { getPlaylist } from '../../api/playlists';
import { getYtLink, getFeatures, refreshPlaylist } from '../../api/ytImport';
import { toast } from '../../lib/toast';

const PLAYLIST = {
  id: 'pl_1', name: 'imported set', canEdit: true, role: 'owner',
  collaborators: [], tracks: [], trackCount: 0, isPublic: false, updatedAt: 1,
};
const LINK = { playlist_id: 'pl_1', yt_playlist_id: 'PLabc', kind: 'PL', last_synced_at: 1 };

const REFRESH = 'Check for new songs';

beforeEach(() => {
  vi.clearAllMocks();
  getPlaylist.mockResolvedValue(PLAYLIST);
  getFeatures.mockResolvedValue({ youtubeImport: true });
  getYtLink.mockResolvedValue(null);
});

const show = () => render(<DesktopPlaylistDetail playlistId="pl_1" onClose={vi.fn()} onPlaySequence={vi.fn()}/>);

describe('where the button must NOT appear', () => {
  it('a playlist that did not come from YouTube', async () => {
    // No link row. This is the case for almost every playlist in the library,
    // and it is the check that protects every existing playlist view.
    getYtLink.mockResolvedValue(null);
    show();
    await waitFor(() => expect(screen.getByText('imported set')).toBeInTheDocument());
    expect(screen.queryByText(REFRESH)).not.toBeInTheDocument();
  });

  it('a playlist imported from a MIX', async () => {
    // finishJob writes a link row only for a finite playlist, so a mix has none
    // — absence of the row IS the gate, with no separate kind check anywhere.
    getYtLink.mockResolvedValue(null);
    show();
    await waitFor(() => expect(screen.getByText('imported set')).toBeInTheDocument());
    expect(screen.queryByText(REFRESH)).not.toBeInTheDocument();
  });

  it('when the feature is off, even with a link row', async () => {
    getFeatures.mockResolvedValue({ youtubeImport: false });
    getYtLink.mockResolvedValue(LINK);
    show();
    await waitFor(() => expect(screen.getByText('imported set')).toBeInTheDocument());
    expect(screen.queryByText(REFRESH)).not.toBeInTheDocument();
    // The link lookup must not even be attempted with the flag off.
    expect(getYtLink).not.toHaveBeenCalled();
  });

  it('when the lookup itself fails', async () => {
    // Fails toward absence: no button beats a button that leads nowhere.
    getYtLink.mockRejectedValue(new Error('offline'));
    show();
    await waitFor(() => expect(screen.getByText('imported set')).toBeInTheDocument());
    expect(screen.queryByText(REFRESH)).not.toBeInTheDocument();
  });
});

describe('checking for new songs', () => {
  beforeEach(() => getYtLink.mockResolvedValue(LINK));

  it('appears on a playlist imported from a finite source', async () => {
    show();
    await waitFor(() => expect(screen.getByText(REFRESH)).toBeInTheDocument());
  });

  it('says so plainly when there is nothing new — the common answer', async () => {
    refreshPlaylist.mockResolvedValue({ changed: false });
    show();
    fireEvent.click(await screen.findByText(REFRESH));
    await waitFor(() => expect(refreshPlaylist).toHaveBeenCalledWith('pl_1'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/nothing new/i)));
  });

  it('re-reads the playlist when songs were added, so they appear without a reload', async () => {
    refreshPlaylist.mockResolvedValue({
      changed: true, id: 'yti_9', status: 'complete', playlistId: 'pl_1',
      counts: { total: 2, auto: 2, review: 0, unmatched: 0, matching: 0 }, items: [],
    });
    getPlaylist.mockResolvedValue({ ...PLAYLIST, tracks: [{ id: 't1', title: 'New Song', artist: 'X' }], trackCount: 1 });
    show();
    fireEvent.click(await screen.findByText(REFRESH));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/2 new songs added/i)));
    // getPlaylist called again after the refresh, not just on mount.
    expect(getPlaylist.mock.calls.length).toBeGreaterThan(1);
  });

  it('offers review only when the refresh found something ambiguous', async () => {
    refreshPlaylist.mockResolvedValue({
      changed: true, id: 'yti_9', status: 'ready', playlistId: 'pl_1',
      counts: { total: 3, auto: 2, review: 1, unmatched: 0, matching: 0 },
      items: [{ id: '1', tier: 'review', state: 'pending', youtube: { title: 'Something' }, candidates: [] }],
    });
    show();
    fireEvent.click(await screen.findByText(REFRESH));
    await waitFor(() => expect(screen.getByText('Check the rest')).toBeInTheDocument());
  });

  it('does not offer review when everything matched confidently', async () => {
    refreshPlaylist.mockResolvedValue({
      changed: true, id: 'yti_9', status: 'complete', playlistId: 'pl_1',
      counts: { total: 2, auto: 2, review: 0, unmatched: 0, matching: 0 }, items: [],
    });
    show();
    fireEvent.click(await screen.findByText(REFRESH));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(screen.queryByText('Check the rest')).not.toBeInTheDocument();
  });

  it('turns a refusal into the words written for it', async () => {
    // YT_NO_LINK is the reason COPY.refresh.notForMixes exists. A status code
    // reaching the user here would defeat the whole copy-pack contract.
    refreshPlaylist.mockRejectedValue(
      Object.assign(new Error('that playlist did not come from YouTube'), { code: 'YT_NO_LINK' }),
    );
    show();
    fireEvent.click(await screen.findByText(REFRESH));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls.at(-1)[0])).not.toMatch(/^\d{3}$/);
  });

  it('cannot be double-fired while a check is in flight', async () => {
    let release;
    refreshPlaylist.mockReturnValue(new Promise(r => { release = r; }));
    show();
    const btn = await screen.findByText(REFRESH);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/checking youtube/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/checking youtube/i));
    release({ changed: false });
    await waitFor(() => expect(refreshPlaylist).toHaveBeenCalledTimes(1));
  });
});

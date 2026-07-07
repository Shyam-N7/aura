import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { DesktopCatalogPlaylistDetail } from './DesktopCatalogPlaylistDetail';

vi.mock('../../api/discover', () => ({ getCatalogPlaylist: vi.fn() }));
vi.mock('../../api/hidden', () => ({ hideTrack: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/addToPlaylistSheet', () => ({ openAddToPlaylist: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../lib/meta', () => ({ setMeta: vi.fn() }));
vi.mock('../../lib/trackContextMenu', () => ({ ctxPress: () => ({}) }));
vi.mock('../../lib/homeCache', () => ({ invalidateHomeCache: vi.fn() }));

import { getCatalogPlaylist } from '../../api/discover';
import { hideTrack } from '../../api/hidden';
import { invalidateHomeCache } from '../../lib/homeCache';

const track = (id, reason) => ({
  id, title: `Song ${id}`, artist: `Artist ${id}`, language: 'tamil',
  durationSec: 200, streamUrl: `s-${id}`, imageUrl: null,
  ...(reason ? { reason } : {}),
});

const autoMix = {
  id: 'auto:on-repeat', kind: 'auto', mixKey: 'on-repeat',
  name: 'on repeat', description: 'what you keep coming back to — updated daily',
  editionLabel: 'edition · mon 6 jul', refreshing: false,
  ruleLine: "made from your listening — skips count. family & kids plays don't.",
  tracks: [track('a', 'you finished this 3× lately'), track('b', '7 plays this month')],
};

const renderDetail = (props = {}) => render(
  <DesktopCatalogPlaylistDetail
    playlistId="auto:on-repeat" initialData={autoMix}
    onClose={vi.fn()} onPlaySequence={vi.fn()} onPlayOne={vi.fn()}
    onPlayNext={vi.fn()} onAddToQueue={vi.fn()} {...props}/>,
);

beforeEach(() => vi.clearAllMocks());

describe('DesktopCatalogPlaylistDetail — made-for-you extensions', () => {
  it('shows the edition line, the rule line, and per-track receipts for a mix', () => {
    renderDetail();
    expect(screen.getByText(/edition · mon 6 jul/)).toBeInTheDocument();
    expect(screen.getByText(/skips count\. family & kids plays don't\./)).toBeInTheDocument();
    expect(screen.getByText('you finished this 3× lately')).toBeInTheDocument();
    expect(screen.getByText('7 plays this month')).toBeInTheDocument();
  });

  it("offers “don't show this again” on mix rows and removes the row on hide", async () => {
    renderDetail();
    fireEvent.click(screen.getAllByLabelText('more')[0]);
    const hide = screen.getByText('don’t show this again');
    fireEvent.click(hide);
    expect(hideTrack).toHaveBeenCalledWith('a');
    await vi.waitFor(() => expect(screen.queryByText('Song a')).not.toBeInTheDocument());
    expect(screen.getByText('Song b')).toBeInTheDocument();
    // Home's cached mixes must be dropped so the shelf can't serve the hidden track.
    expect(invalidateHomeCache).toHaveBeenCalledWith('autoPlaylists');
  });

  it('stays inert for catalog playlists — no edition/receipt lines, no hide item', async () => {
    getCatalogPlaylist.mockResolvedValue({ name: 'editorial hits', tracks: [track('c')] });
    render(
      <DesktopCatalogPlaylistDetail playlistId="pl-1"
        onClose={vi.fn()} onPlaySequence={vi.fn()} onPlayOne={vi.fn()}
        onPlayNext={vi.fn()} onAddToQueue={vi.fn()}/>,
    );
    expect(await screen.findByText('Song c')).toBeInTheDocument();
    expect(screen.queryByText(/edition ·/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('more')[0]);
    expect(screen.queryByText('don’t show this again')).not.toBeInTheDocument();
    expect(screen.getByText('play song')).toBeInTheDocument();
  });
});

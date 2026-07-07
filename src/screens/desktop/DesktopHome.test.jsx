import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../api/stats', () => ({
  getMostPlayed: vi.fn().mockResolvedValue([]),
  getTopArtists: vi.fn().mockResolvedValue([]),
  getRecentlyPlayed: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/playlists', () => ({ listPlaylists: vi.fn().mockResolvedValue([]) }));
vi.mock('../../api/autoPlaylists', () => ({ listAutoPlaylists: vi.fn() }));
vi.mock('../../api/discover', () => ({
  getDiscoverHome: vi.fn().mockResolvedValue({ trending: [], popularPlaylists: [], movieSongs: [] }),
}));
vi.mock('../../lib/trackContextMenu', () => ({ ctxPress: () => ({}) }));

import { listAutoPlaylists } from '../../api/autoPlaylists';
import { DesktopHome } from './DesktopHome';

const mix = (mixKey, extra = {}) => ({
  id: `auto:${mixKey}`, kind: 'auto', mixKey, name: mixKey.replace(/-/g, ' '),
  description: 'desc', editionLabel: 'edition · mon 6 jul', refreshing: false,
  tracks: [], trackCount: 0, coverImageUrl: null, ...extra,
});

const renderHome = () => render(
  <DesktopHome tracks={[]} djName="aura" currentTrackId={null} track={null}
    onOpenPlayer={vi.fn()} activeMode="everyday" modes={[]} onSetMode={vi.fn()}
    onPick={vi.fn()} onPickLive={vi.fn()} onPlaySequence={vi.fn()} onOpenJournal={vi.fn()}
    onOpenDna={vi.fn()} onOpenBridges={vi.fn()} onOpenBridge={vi.fn()}
    onOpenCatalogPlaylist={vi.fn()} onOpenPlaylistDetail={vi.fn()} onOpenAuto={vi.fn()}
    onOpenPlaylists={vi.fn()} onOpenSearch={vi.fn()} onOpenArtist={vi.fn()}
    t={{ theme: 'dusk' }} setTweak={vi.fn()}/>,
);

// DesktopHome keeps a module-level fetch cache across mounts, so this file uses
// one dataset for its single scenario test.
describe('DesktopHome — made-for-you shelf', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 6, 22, 0, 0));   // 10pm local — night window
    listAutoPlaylists.mockResolvedValue([
      mix('on-repeat', { refreshing: true }),
      mix('morning', { name: 'your morning songs' }),
      mix('night', { name: 'your night songs' }),
      mix('new-to-you', {
        kind: 'auto-gate', editionLabel: undefined,
        gate: { need: 30, have: 14, line: "unlocks after ~30 songs — you're at 14" },
      }),
    ]);
  });
  afterEach(() => vi.useRealTimers());

  it('windows daypart mixes by local hour and renders gate/edition/refreshing states', async () => {
    renderHome();
    expect(await screen.findByText(/edition · mon 6 jul · refreshing…/)).toBeInTheDocument();
    expect(screen.getByText('your night songs')).toBeInTheDocument();       // 10pm → night shows
    expect(screen.queryByText('your morning songs')).not.toBeInTheDocument();
    const gateLine = screen.getByText("unlocks after ~30 songs — you're at 14");
    expect(gateLine.closest('button')).toBeNull();                          // gate card is inert
    // One-tap ▶ on real mix tiles (parity with the playlists screen); none on gates.
    expect(screen.getByLabelText('play on repeat')).toBeInTheDocument();
    expect(screen.queryByLabelText('play new to you')).toBeNull();
  });
});

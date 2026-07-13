import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { DesktopLibrary } from './DesktopLibrary';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { name: 'shyam', email: 's@x.com' }, isAuthed: true }),
  logout: vi.fn(),
  enableFamilyMode: vi.fn(),
  disableFamilyMode: vi.fn(),
  updatePreferences: vi.fn().mockResolvedValue({}),
  listDevices: vi.fn().mockResolvedValue({ sessions: [], currentId: null, limit: 3 }),
  revokeDevice: vi.fn().mockResolvedValue(),
  logoutOtherDevices: vi.fn().mockResolvedValue(),
}));
vi.mock('../../lib/confirm', () => ({ confirm: vi.fn().mockResolvedValue(false) }));
vi.mock('../../api/account', () => ({ exportMyData: vi.fn(), deleteMyAccount: vi.fn() }));
vi.mock('../../api/library', () => ({
  getLibrarySummary: vi.fn().mockResolvedValue({ tracksPlayed: 12, minutesListened: 340 }),
}));
vi.mock('../../api/likes', () => ({
  listLiked: vi.fn().mockResolvedValue([
    { id: 't1', title: 'Song One',   artist: 'A', language: 'tamil' },
    { id: 't2', title: 'Song Two',   artist: 'B', language: 'tamil' },
    { id: 't3', title: 'Song Three', artist: 'C', language: 'tamil' },
    { id: 't4', title: 'Song Four',  artist: 'D', language: 'tamil' },
    { id: 't5', title: 'Song Five',  artist: 'E', language: 'tamil' },
  ]),
}));
vi.mock('../../api/playlists', () => ({
  listPlaylists: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Drive', trackCount: 3 }]),
}));
vi.mock('../../api/stats', () => ({
  getHistory: vi.fn().mockResolvedValue({ plays: [], nextBefore: null }),
}));
vi.mock('../../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../lib/addToPlaylistSheet', () => ({ openAddToPlaylist: vi.fn() }));
vi.mock('../../lib/trackContextMenu', () => ({ openTrackMenu: vi.fn() }));

const shelfHead = (title) => screen.getByText(title).closest('button');
const renderLib = (props = {}) =>
  render(<DesktopLibrary t={{ theme: 'dusk' }} setTweak={vi.fn()} {...props}/>);

beforeEach(() => sessionStorage.clear());

describe('DesktopLibrary glass shelves', () => {
  it('renders five closed shelves and the pinned your-year card', async () => {
    renderLib();
    for (const title of ['liked songs', 'playlists', 'history', 'languages', 'settings']) {
      expect((await screen.findByText(title)).closest('button')).toHaveAttribute('aria-expanded', 'false');
    }
    // Your year is pinned open — its data is visible with NO interaction.
    expect(await screen.findByText('your year')).toBeInTheDocument();
    expect(screen.getByText(/12 tracks played/)).toBeInTheDocument();
    expect(screen.getByText(/340 minutes/)).toBeInTheDocument();
    expect(screen.getByText('your year').closest('button')).toBeNull();
  });

  it('opens one shelf at a time (accordion)', async () => {
    renderLib();
    fireEvent.click(await screen.findByText('liked songs'));
    expect(shelfHead('liked songs')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByText('playlists'));
    expect(shelfHead('playlists')).toHaveAttribute('aria-expanded', 'true');
    expect(shelfHead('liked songs')).toHaveAttribute('aria-expanded', 'false');
  });

  it('remembers the open shelf for the session', async () => {
    renderLib();
    fireEvent.click(await screen.findByText('languages'));
    expect(sessionStorage.getItem('aura.libraryShelf')).toBe('languages');
    fireEvent.click(screen.getByText('languages'));
    expect(sessionStorage.getItem('aura.libraryShelf')).toBeNull();
  });

  it('caps the liked shelf at the top 4, with SEE ALL for the rest', async () => {
    renderLib({ onOpenLiked: () => {} });
    fireEvent.click(await screen.findByText('liked songs'));
    expect(screen.getByText('Song Four')).toBeInTheDocument();
    expect(screen.queryByText('Song Five')).toBeNull();
    expect(screen.getByText('SEE ALL →')).toBeInTheDocument();
  });

  it('expands settings in place with the full inline panel', async () => {
    renderLib();
    fireEvent.click(await screen.findByText('settings'));
    expect(shelfHead('settings')).toHaveAttribute('aria-expanded', 'true');
    // The panel content is right there — no navigation.
    expect(screen.getByText('appearance')).toBeInTheDocument();
    expect(screen.getByText('delete my account')).toBeInTheDocument();
  });

  it('signs the screen with the floating identity chip', async () => {
    renderLib();
    expect(await screen.findByText('shyam')).toBeInTheDocument();
    expect(screen.getByText('s@x.com')).toBeInTheDocument();
  });

  it('shows "nothing yet" peeks when a shelf is empty', async () => {
    const { listLiked } = await import('../../api/likes');
    const { listPlaylists } = await import('../../api/playlists');
    listLiked.mockResolvedValueOnce([]);
    listPlaylists.mockResolvedValueOnce([]);
    renderLib();
    await screen.findByText('liked songs');
    // liked + history + playlists all empty here (history has no plays in tests).
    expect(screen.getAllByText('nothing yet')).toHaveLength(3);
  });
});

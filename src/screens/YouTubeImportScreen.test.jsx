import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { YouTubeImportScreen } from './YouTubeImportScreen';

vi.mock('../api/ytImport', async (importOriginal) => ({
  ...(await importOriginal()),
  previewLink: vi.fn(),
  startImport: vi.fn(),
  cancelImport: vi.fn(),
  pollImport: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../lib/confirm', () => ({ confirm: vi.fn(() => Promise.resolve(true)) }));

import { previewLink, startImport } from '../api/ytImport';

const paste = (value = 'https://www.youtube.com/playlist?list=PLabc') =>
  fireEvent.change(screen.getByPlaceholderText(/paste a youtube/i), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  previewLink.mockResolvedValue({ importable: true, windowed: false, windowSize: null, kind: 'PL' });
  startImport.mockResolvedValue({
    id: 'yti_1', status: 'ready', playlistId: 'pl_1',
    counts: { total: 3, auto: 2, review: 1, unmatched: 0, matching: 0 }, items: [],
  });
});

describe('pasting', () => {
  it('checks the link and offers to import it', async () => {
    render(<YouTubeImportScreen onClose={vi.fn()}/>);
    paste();
    await waitFor(() => expect(previewLink).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument());
  });

  it('turns a refusal into copy written for that exact case', async () => {
    // The point of the code contract: the user gets a specific instruction, not
    // the server's prose and not "something went wrong".
    previewLink.mockRejectedValue(
      Object.assign(new Error('server prose'), { code: 'YT_WATCH_LATER' }),
    );
    render(<YouTubeImportScreen onClose={vi.fn()}/>);
    paste('https://www.youtube.com/playlist?list=WL');
    await waitFor(() => expect(screen.getByText(/Watch Later cannot be read by any app/)).toBeInTheDocument());
    expect(screen.queryByText('server prose')).not.toBeInTheDocument();
  });

  it('falls back to the server message for a code it has never seen', async () => {
    previewLink.mockRejectedValue(
      Object.assign(new Error('that playlist is haunted'), { code: 'YT_FROM_THE_FUTURE' }),
    );
    render(<YouTubeImportScreen onClose={vi.fn()}/>);
    paste();
    await waitFor(() => expect(screen.getByText('that playlist is haunted')).toBeInTheDocument());
  });
});

describe('a mix, which has no end', () => {
  it('says snapshot-not-sync BEFORE the user commits', async () => {
    // Said here it is information. Said after the import it is an excuse — and
    // the mix genuinely does regenerate, so this is the honest moment for it.
    previewLink.mockResolvedValue({ importable: true, windowed: true, windowSize: 30, kind: 'RD_RADIO' });
    render(<YouTubeImportScreen onClose={vi.fn()}/>);
    paste('https://www.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk');
    await waitFor(() => expect(screen.getByText(/first 30 songs/)).toBeInTheDocument());
    expect(screen.getByText(/snapshot, not a live sync/)).toBeInTheDocument();
  });
});

describe('finishing', () => {
  it('reports the counts and offers review without apologising for it', async () => {
    render(<YouTubeImportScreen onClose={vi.fn()}/>);
    paste();
    await waitFor(() => screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(screen.getByText('2 songs added')).toBeInTheDocument());
    expect(screen.getByText(/1 to check/)).toBeInTheDocument();
    // The playlist already exists and already plays; review is optional and the
    // screen must say so, or people feel obliged to finish before listening.
    expect(screen.getByText(/ready to play now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check the rest' })).toBeInTheDocument();
  });

  it('says plainly when nothing matched, rather than showing an empty success', async () => {
    startImport.mockResolvedValue({
      id: 'yti_1', status: 'complete', playlistId: null,
      counts: { total: 3, auto: 0, review: 0, unmatched: 3, matching: 0 }, items: [],
    });
    render(<YouTubeImportScreen onClose={vi.fn()}/>);
    paste();
    await waitFor(() => screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getByText(/couldn’t find any of these songs/i)).toBeInTheDocument());
  });
});

describe('failing', () => {
  it('offers a retry only where retrying can change the answer', async () => {
    startImport.mockResolvedValue({
      id: 'yti_1', status: 'failed', error: 'YT_QUOTA', counts: {}, items: [],
    });
    render(<YouTubeImportScreen onClose={vi.fn()}/>);
    paste();
    await waitFor(() => screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(screen.getByText(/paused until tomorrow/i)).toBeInTheDocument());
    // A retry button on an exhausted daily quota is a lie the user pays for by
    // pressing it.
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
  });

  it('does offer one for a failure that could clear', async () => {
    startImport.mockResolvedValue({
      id: 'yti_1', status: 'failed', error: 'YT_UNREACHABLE', counts: {}, items: [],
    });
    render(<YouTubeImportScreen onClose={vi.fn()}/>);
    paste();
    await waitFor(() => screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.getByText(/couldn't reach YouTube/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });
});

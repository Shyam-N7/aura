import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { YouTubeReviewScreen } from './YouTubeReviewScreen';

// The review screen decides roughly a third of every import, so what is pinned
// here is the DECISION path — that a choice reaches the server, that a skip
// does, that a row with nothing to choose from does not look like the user's
// fault, and that a candidate the server has stopped recognising cannot trap
// someone on a row they are unable to answer.

vi.mock('../api/ytImport', () => ({
  resolveItem: vi.fn(() => Promise.resolve({ pending: 0, accepted: 1 })),
  pollImport: vi.fn(() => Promise.resolve({ id: 'yti_1', status: 'complete', counts: {} })),
}));
vi.mock('../lib/toast', () => ({ toast: vi.fn() }));

import { resolveItem, pollImport } from '../api/ytImport';
import { toast } from '../lib/toast';

const reviewItem = (over = {}) => ({
  id: '1', position: 0, tier: 'review', state: 'pending',
  youtube: { title: 'Kesariya (Official Video)', channel: 'T-Series', durationSec: 268 },
  candidates: [
    {
      id: 'c1', title: 'Kesariya', artist: 'Arijit Singh', album: 'Brahmastra',
      durationSec: 268, imageUrl: null, score: 0.79,
      reading: { title: 'Kesariya', artists: ['Arijit Singh'] },
    },
    {
      id: 'c2', title: 'Kesariya (Lofi)', artist: 'Someone', album: 'Lofi Vibes',
      durationSec: 250, imageUrl: null, score: 0.64, reading: { title: 'Kesariya', artists: [] },
    },
  ],
  ...over,
});

const job = (items) => ({ id: 'yti_1', status: 'ready', playlistId: 'pl_1', counts: {}, items });

beforeEach(() => vi.clearAllMocks());

describe('choosing', () => {
  it('sends the chosen candidate and moves on', async () => {
    render(<YouTubeReviewScreen job={job([reviewItem(), reviewItem({ id: '2', position: 1 })])} onDone={vi.fn()}/>);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Kesariya')[0]);
    await waitFor(() => expect(resolveItem).toHaveBeenCalledWith('yti_1', '1', { trackId: 'c1' }));
    await waitFor(() => expect(screen.getByText('2 of 2')).toBeInTheDocument());
  });

  it('sends a skip as a skip, not as an empty choice', async () => {
    render(<YouTubeReviewScreen job={job([reviewItem()])} onDone={vi.fn()}/>);
    fireEvent.click(screen.getByText('Skip'));
    await waitFor(() => expect(resolveItem).toHaveBeenCalledWith('yti_1', '1', { skip: true }));
  });

  it('shows the reading that produced the match', () => {
    // The whole reason a choice here is explicable rather than arbitrary:
    // "A - B" is song-artist in Indian titles and artist-song in Western ones,
    // and the matcher scores both. Naming the winner is the explanation.
    render(<YouTubeReviewScreen job={job([reviewItem()])} onDone={vi.fn()}/>);
    expect(screen.getByText(/We read this as “Kesariya” by Arijit Singh/)).toBeInTheDocument();
  });

  it('shows length drift, because duration is what separates a song from its remix', () => {
    render(<YouTubeReviewScreen job={job([reviewItem()])} onDone={vi.fn()}/>);
    expect(screen.getByText(/same length/)).toBeInTheDocument();
    expect(screen.getByText(/18s shorter/)).toBeInTheDocument();
  });
});

describe('a row with nothing to choose from', () => {
  it('says it is not the user’s fault, and offers no candidates', () => {
    render(<YouTubeReviewScreen job={job([reviewItem({ candidates: [] })])} onDone={vi.fn()}/>);
    expect(screen.getByText(/couldn’t find this one/i)).toBeInTheDocument();
    expect(screen.getByText(/isn’t something you did/i)).toBeInTheDocument();
    // Skip is still available — it is the only answer, and it must be reachable.
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });
});

describe('when the server refuses a choice', () => {
  it('moves past a candidate it no longer recognises instead of trapping the user', async () => {
    // Tapping the same dead candidate forever is the failure mode being
    // prevented: the row cannot be answered any other way.
    resolveItem.mockRejectedValueOnce(
      Object.assign(new Error('that suggestion is no longer available'), { code: 'YT_NOT_OFFERED' }),
    );
    render(<YouTubeReviewScreen job={job([reviewItem(), reviewItem({ id: '2', position: 1 })])} onDone={vi.fn()}/>);
    fireEvent.click(screen.getAllByText('Kesariya')[0]);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('2 of 2')).toBeInTheDocument());
  });

  it('stays on the row for a failure that retrying could fix', async () => {
    resolveItem.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'YT_UNREACHABLE' }));
    render(<YouTubeReviewScreen job={job([reviewItem(), reviewItem({ id: '2', position: 1 })])} onDone={vi.fn()}/>);
    fireEvent.click(screen.getAllByText('Kesariya')[0]);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });
});

describe('the queue holds still', () => {
  it('only queues review items, never auto or unmatched ones', () => {
    render(<YouTubeReviewScreen onDone={vi.fn()} job={job([
      reviewItem(),
      { id: '9', position: 1, tier: 'auto', state: 'done', youtube: { title: 'Already in' }, candidates: [] },
      { id: '8', position: 2, tier: 'unmatched', state: 'done', youtube: { title: 'Not found' }, candidates: [] },
    ])}/>);
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });

  it('re-reads the job on the way out so the caller’s summary is current', async () => {
    const onDone = vi.fn();
    render(<YouTubeReviewScreen job={job([reviewItem()])} onDone={onDone}/>);
    fireEvent.click(screen.getByText('Skip the rest'));
    await waitFor(() => expect(pollImport).toHaveBeenCalledWith('yti_1'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('still closes when that re-read fails', async () => {
    // A stale summary is harmless; a screen that cannot be left is not.
    pollImport.mockRejectedValueOnce(new Error('offline'));
    const onDone = vi.fn();
    render(<YouTubeReviewScreen job={job([reviewItem()])} onDone={onDone}/>);
    fireEvent.click(screen.getByText('Skip the rest'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
  });
});

describe('finishing', () => {
  it('reports what was added and reports songs the catalogue lacks', async () => {
    render(<YouTubeReviewScreen onDone={vi.fn()} job={job([
      reviewItem(),
      { id: '8', position: 1, tier: 'unmatched', state: 'done', youtube: { title: 'Not found' }, candidates: [] },
    ])}/>);
    fireEvent.click(screen.getAllByText('Kesariya')[0]);
    await waitFor(() => expect(screen.getByText('1 song added')).toBeInTheDocument());
    expect(screen.getByText('1 not in our catalogue')).toBeInTheDocument();
  });
});

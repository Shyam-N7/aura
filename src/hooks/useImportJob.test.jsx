import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImportJob, progressOf } from './useImportJob';

// Polling here is not a read — each GET does a slice of the matching work on
// the server, because the deployment has no background worker. That makes the
// lifecycle load-bearing in both directions: stopping too early stalls the
// import, and failing to stop burns real upstream budget on a job nobody is
// watching. Those are the two things pinned below.

vi.mock('../api/ytImport', async (importOriginal) => ({
  ...(await importOriginal()),
  pollImport: vi.fn(),
}));

import { pollImport } from '../api/ytImport';

const job = (status, over = {}) => ({ id: 'yti_1', status, counts: {}, ...over });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('when there is work to do', () => {
  it('polls while the job is live', async () => {
    pollImport.mockResolvedValue(job('matching'));
    renderHook(() => useImportJob(job('matching')));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(pollImport).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(pollImport).toHaveBeenCalledTimes(2);
  });


  it('chases while the server says its drain ran out of budget mid-work', async () => {
    // workRemaining: true = the drain hit its budget with items pending — the
    // server is explicitly waiting to be driven again. The gap collapses to
    // CHASE_MS; when the flag drops, the idle cadence returns.
    pollImport.mockResolvedValue(job('matching', { workRemaining: true }));
    renderHook(() => useImportJob(job('matching')));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(pollImport).toHaveBeenCalledTimes(1);

    // 300ms later, not 2000: the next poll was chased.
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(pollImport).toHaveBeenCalledTimes(2);

    // Flag gone (finished slice, or an un-upgraded server): idle cadence.
    pollImport.mockResolvedValue(job('matching'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(pollImport).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(pollImport).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
    expect(pollImport).toHaveBeenCalledTimes(4);
  });

  it('a failed poll falls back to the idle cadence, never a 300ms retry hammer', async () => {
    pollImport.mockResolvedValueOnce(job('matching', { workRemaining: true }));
    pollImport.mockRejectedValueOnce(new Error('boom'));
    pollImport.mockResolvedValue(job('matching'));
    renderHook(() => useImportJob(job('matching')));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });   // ok, chase armed
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });    // chased poll fails
    expect(pollImport).toHaveBeenCalledTimes(2);
    // The retry is on the idle gap, not the chase gap.
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(pollImport).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
    expect(pollImport).toHaveBeenCalledTimes(3);
  });

  it('stops the moment the job reaches a terminal status', async () => {
    // Not just wasteful: the server would keep taking a lease on a finished job.
    pollImport.mockResolvedValueOnce(job('ready'));
    const { result } = renderHook(() => useImportJob(job('matching')));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.job.status).toBe('ready');

    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(pollImport).toHaveBeenCalledTimes(1);
  });

  it('never starts for a job that is already finished', async () => {
    renderHook(() => useImportJob(job('complete')));
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(pollImport).not.toHaveBeenCalled();
  });

  it('stops on unmount', async () => {
    // The leak that costs money: a closed screen still driving drains.
    pollImport.mockResolvedValue(job('matching'));
    const { unmount } = renderHook(() => useImportJob(job('matching')));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(pollImport).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(pollImport).toHaveBeenCalledTimes(1);
  });

  it('stops when asked', async () => {
    pollImport.mockResolvedValue(job('matching'));
    const { result } = renderHook(() => useImportJob(job('matching')));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    act(() => result.current.stop());
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(pollImport).toHaveBeenCalledTimes(1);
  });
});

describe('when a poll fails', () => {
  it('keeps polling, because the next poll is also the next attempt at the work', async () => {
    // A failed poll is not a failed import — the job is still on the server and
    // the cron will finish it. Giving up here would strand it.
    pollImport
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(job('matching'));
    const { result } = renderHook(() => useImportJob(job('matching')));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.error).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(pollImport).toHaveBeenCalledTimes(2);
    // The act above already flushed the recovery; waitFor would hang here,
    // since it polls on real time while fake timers are installed.
    expect(result.current.error).toBeNull();
  });
});

describe('backing off', () => {
  it('slows down once a job is clearly stuck rather than slow', async () => {
    // A 30-track import finishes in one or two ticks. Twenty is well past slow,
    // and a tab left open on a stuck job should not spin at 2s forever.
    pollImport.mockResolvedValue(job('matching'));
    renderHook(() => useImportJob(job('matching')));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000 * 20); });
    const atSwitch = pollImport.mock.calls.length;

    // Two seconds is no longer enough to earn another poll.
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(pollImport).toHaveBeenCalledTimes(atSwitch);

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(pollImport).toHaveBeenCalledTimes(atSwitch + 1);
  });
});

describe('progressOf', () => {
  it('derives done from total minus still-matching', () => {
    expect(progressOf(job('matching', { counts: { total: 30, matching: 12 } })))
      .toEqual({ done: 18, total: 30, pct: 60 });
  });

  it('never reports more done than there are songs', () => {
    // total is written at the end of the fetch phase, so for one tick the two
    // can disagree. "31 of 30" is small, and exactly the kind of small thing
    // that costs trust.
    expect(progressOf(job('matching', { counts: { total: 30, matching: -5 } })).done).toBe(30);
    expect(progressOf(job('matching', { counts: { total: 30, matching: 99 } })).done).toBe(0);
  });

  it('survives a job with no counts yet', () => {
    expect(progressOf(null)).toEqual({ done: 0, total: 0, pct: 0 });
    expect(progressOf(job('queued'))).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

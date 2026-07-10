import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/auth', () => ({ fetchAuthed: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('../lib/homeCache', () => ({ invalidateHomeCache: vi.fn() }));

// The listen counter is module state — each spec re-imports a fresh instance
// (and the matching mock instance it calls) via resetModules.
async function freshEvents() {
  vi.resetModules();
  const { invalidateHomeCache } = await import('../lib/homeCache');
  const { postEvent } = await import('./events');
  return { postEvent, invalidateHomeCache };
}

describe('postEvent home-cache invalidation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalidates the listening-derived keys every 5th play/end, not before', async () => {
    const { postEvent, invalidateHomeCache } = await freshEvents();
    for (let i = 0; i < 4; i++) postEvent(`t${i}`, 'play');
    expect(invalidateHomeCache).not.toHaveBeenCalled();
    postEvent('t4', 'end');
    expect(invalidateHomeCache).toHaveBeenCalledTimes(1);
    expect(invalidateHomeCache).toHaveBeenCalledWith('quickPicks', 'mostPlayed', 'recentlyPlayed');
    // The counter resets — the next four listens stay quiet again.
    for (let i = 0; i < 4; i++) postEvent(`t${i}`, 'play');
    expect(invalidateHomeCache).toHaveBeenCalledTimes(1);
  });

  it('pause/skip/seek do not advance the listen counter', async () => {
    const { postEvent, invalidateHomeCache } = await freshEvents();
    for (let i = 0; i < 10; i++) postEvent(`t${i}`, 'pause');
    for (let i = 0; i < 10; i++) postEvent(`t${i}`, 'skip');
    expect(invalidateHomeCache).not.toHaveBeenCalled();
  });

  it('ignores calls without a track or kind', async () => {
    const { postEvent, invalidateHomeCache } = await freshEvents();
    for (let i = 0; i < 9; i++) { postEvent(null, 'play'); postEvent('t1', null); }
    expect(invalidateHomeCache).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RELEASES, LATEST_ID } from '../data/whatsNew';
import { getSeen, markSeen, initSeen, unseenReleases, openWhatsNew, subscribeWhatsNew } from './whatsNew';

beforeEach(() => localStorage.clear());

describe('seen-version storage', () => {
  it('initSeen treats an onboarded no-key device as an existing user (show current)', () => {
    localStorage.setItem('aura.hasOnboarded', '1');
    initSeen();
    expect(getSeen()).toBe(0);
    expect(unseenReleases().map(r => r.id)).toEqual(RELEASES.map(r => r.id));
  });

  it('initSeen silently catches a brand-new user up (never announce on first session)', () => {
    initSeen();
    expect(getSeen()).toBe(LATEST_ID);
    expect(unseenReleases()).toEqual([]);
  });

  it('initSeen never overwrites an existing value', () => {
    markSeen(1);
    initSeen();
    expect(getSeen()).toBe(1);
  });

  it('unseenReleases returns only releases newer than the seen id, and markSeen clears them', () => {
    markSeen(1);
    const pending = unseenReleases();
    expect(pending.every(r => r.id > 1)).toBe(true);
    expect(pending.length).toBeGreaterThan(0);
    markSeen();
    expect(unseenReleases()).toEqual([]);
  });

  it('treats garbage storage as unset', () => {
    localStorage.setItem('aura.whatsNewSeen', 'nope');
    expect(getSeen()).toBeNull();
  });
});

describe('open/subscribe bus', () => {
  it('replays an open fired before the host mounted (pending), then delivers live', () => {
    openWhatsNew({ releases: RELEASES });
    const cb = vi.fn();
    const off = subscribeWhatsNew(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].releases).toEqual(RELEASES);
    openWhatsNew({ releases: [RELEASES[0]] });
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });

  it('ignores empty release lists', () => {
    const cb = vi.fn();
    const off = subscribeWhatsNew(cb);
    openWhatsNew({ releases: [] });
    expect(cb).not.toHaveBeenCalled();
    off();
  });
});

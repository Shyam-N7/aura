import { describe, it, expect, beforeEach } from 'vitest';
import { homeCache, invalidateHomeCache } from './homeCache';

beforeEach(() => invalidateHomeCache());

describe('homeCache', () => {
  it('invalidates only the named keys', () => {
    homeCache.autoPlaylists = [1];
    homeCache.discover = { trending: [] };
    invalidateHomeCache('autoPlaylists');
    expect(homeCache.autoPlaylists).toBeUndefined();
    expect(homeCache.discover).toEqual({ trending: [] });
  });

  it('invalidates everything when called bare', () => {
    homeCache.a = 1;
    homeCache.b = 2;
    invalidateHomeCache();
    expect(Object.keys(homeCache)).toHaveLength(0);
  });
});

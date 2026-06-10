import { describe, it, expect } from 'vitest';
import { parsePath, buildPath, pathIsActive } from './routes';

describe('parsePath / buildPath', () => {
  it('round-trips simple screens', () => {
    for (const screen of ['search', 'library', 'liked', 'playlists', 'journal', 'dna', 'bridges', 'talk', 'queue', 'player']) {
      const path = buildPath({ screen });
      expect(parsePath(path)).toEqual({ screen });
    }
  });

  it('maps home to /', () => {
    expect(buildPath({ screen: 'home' })).toBe('/');
    expect(parsePath('/')).toEqual({ screen: 'home' });
    expect(parsePath('')).toEqual({ screen: 'home' });
    expect(parsePath('/home')).toEqual({ screen: 'home' });
  });

  it('round-trips entity routes', () => {
    expect(parsePath(buildPath({ screen: 'artist', artistKey: { id: 'abc123' } })))
      .toEqual({ screen: 'artist', artistKey: { id: 'abc123' } });
    expect(parsePath(buildPath({ screen: 'album-detail', albumId: 'al9' })))
      .toEqual({ screen: 'album-detail', albumId: 'al9' });
    expect(parsePath(buildPath({ screen: 'playlist-detail', detailPlaylistId: '42' })))
      .toEqual({ screen: 'playlist-detail', detailPlaylistId: '42' });
    expect(parsePath(buildPath({ screen: 'catalog-playlist-detail', catalogPlaylistId: 'c7' })))
      .toEqual({ screen: 'catalog-playlist-detail', catalogPlaylistId: 'c7' });
    expect(parsePath(buildPath({ screen: 'language-hub', hubLang: 'tamil' })))
      .toEqual({ screen: 'language-hub', hubLang: 'tamil' });
  });

  it('round-trips by-name artists with dots and spaces', () => {
    const state = { screen: 'artist', artistKey: { name: 'A.R. Rahman' } };
    const path = buildPath(state);
    expect(path).toBe('/artist/by-name/A.R.%20Rahman');
    expect(parsePath(path)).toEqual(state);
  });

  it('falls back to home for unknown or gate routes', () => {
    expect(parsePath('/garbage')).toEqual({ screen: 'home' });
    expect(parsePath('/artist/')).toEqual({ screen: 'home' });   // empty id → no match
    expect(buildPath({ screen: 'artist' })).toBe('/');           // artist without key
    expect(buildPath(null)).toBe('/');
  });
});

describe('pathIsActive', () => {
  it('treats / and /auth as not-an-app-route', () => {
    expect(pathIsActive('/')).toBe(false);
    expect(pathIsActive('/auth')).toBe(false);
    expect(pathIsActive('')).toBe(false);
    expect(pathIsActive('/artist/abc')).toBe(true);
    expect(pathIsActive('/search')).toBe(true);
  });
});

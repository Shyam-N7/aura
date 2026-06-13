import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAudioQuality, setAudioQuality, subscribeAudioQuality,
  bitrateFor, swapBitrate, qualityLadder, DEFAULT_QUALITY,
} from './audioQuality';

beforeEach(() => localStorage.clear());

describe('swapBitrate', () => {
  it('rewrites the bitrate suffix', () => {
    expect(swapBitrate('https://cdn/x/song_96.mp4', 320)).toBe('https://cdn/x/song_96.mp4'.replace('_96', '_320'));
    expect(swapBitrate('https://cdn/x/song_320.mp4', 160)).toBe('https://cdn/x/song_160.mp4');
  });

  it('preserves the query string', () => {
    expect(swapBitrate('https://cdn/x/song_96.mp4?a=1&b=2', 320)).toBe('https://cdn/x/song_320.mp4?a=1&b=2');
  });

  it('leaves a url without a bitrate token untouched', () => {
    expect(swapBitrate('https://cdn/x/song.mp3', 320)).toBe('https://cdn/x/song.mp3');
  });
});

describe('qualityLadder', () => {
  it('descends from the chosen bitrate to the floor', () => {
    expect(qualityLadder('https://cdn/song_96.mp4', 320)).toEqual([
      'https://cdn/song_320.mp4',
      'https://cdn/song_160.mp4',
      'https://cdn/song_96.mp4',
      'https://cdn/song_48.mp4',
    ]);
  });

  it('never climbs above the chosen bitrate', () => {
    expect(qualityLadder('https://cdn/song_320.mp4', 96)).toEqual([
      'https://cdn/song_96.mp4',
      'https://cdn/song_48.mp4',
    ]);
  });

  it('returns the url as-is when there is no swappable token', () => {
    expect(qualityLadder('https://cdn/song.mp3', 320)).toEqual(['https://cdn/song.mp3']);
  });

  it('returns nothing for an empty url', () => {
    expect(qualityLadder('', 320)).toEqual([]);
  });
});

describe('bitrateFor', () => {
  it('maps tier ids to bitrates and falls back to the top tier', () => {
    expect(bitrateFor('high')).toBe(320);
    expect(bitrateFor('normal')).toBe(160);
    expect(bitrateFor('low')).toBe(96);
    expect(bitrateFor('bogus')).toBe(320);
  });
});

describe('preference get/set/subscribe', () => {
  it('defaults to high and ignores invalid stored values', () => {
    expect(getAudioQuality()).toBe(DEFAULT_QUALITY);
    localStorage.setItem('aura.audioQuality', 'ultra');
    expect(getAudioQuality()).toBe('high');
  });

  it('persists valid values and rejects invalid ones', () => {
    setAudioQuality('low');
    expect(getAudioQuality()).toBe('low');
    setAudioQuality('nope');
    expect(getAudioQuality()).toBe('low');
  });

  it('notifies subscribers until they unsubscribe', () => {
    const cb = vi.fn();
    const off = subscribeAudioQuality(cb);
    setAudioQuality('normal');
    expect(cb).toHaveBeenCalledWith('normal');
    off();
    setAudioQuality('high');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

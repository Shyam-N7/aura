import { describe, it, expect } from 'vitest';
import { matchLocalIntent } from './voiceIntents';

const kindOf = (t) => matchLocalIntent(t)?.kind ?? null;

describe('matchLocalIntent — instant local transport commands', () => {
  it('maps transport verbs (and their synonyms / punctuation)', () => {
    expect(kindOf('next')).toBe('next');
    expect(kindOf('Skip!')).toBe('next');
    expect(kindOf('skip this song')).toBe('next');
    expect(kindOf('previous')).toBe('prev');
    expect(kindOf('go back')).toBe('prev');
    expect(kindOf('pause')).toBe('pause');
    expect(kindOf('stop the music')).toBe('pause');
  });

  it('maps volume + mute', () => {
    expect(kindOf('louder')).toBe('louder');
    expect(kindOf('turn it up')).toBe('louder');
    expect(kindOf('volume down')).toBe('softer');
    expect(kindOf('quieter please')).toBe('softer');
    expect(kindOf('mute')).toBe('mute');
    expect(kindOf('unmute')).toBe('unmute');
  });

  it('maps like / shuffle / repeat / restart', () => {
    expect(kindOf('like this')).toBe('like');
    expect(kindOf('I love this song')).toBe('like');
    expect(kindOf('shuffle')).toBe('shuffle');
    expect(kindOf('repeat')).toBe('repeat');
    expect(kindOf('start over')).toBe('restart');
  });

  it('treats a bare "play"/"resume" as resume, but "play <x>" as a search (null)', () => {
    expect(kindOf('play')).toBe('play');
    expect(kindOf('resume')).toBe('play');
    expect(kindOf('keep playing')).toBe('play');
    expect(kindOf('play despacito')).toBeNull();
    expect(kindOf('play something upbeat')).toBeNull();
    expect(kindOf('play A.R. Rahman')).toBeNull();
  });

  it('does NOT let a control word inside a "play <title>" hijack the search (→ LLM)', () => {
    expect(kindOf('play back to december')).toBeNull();   // "back" — would have been prev
    expect(kindOf('play skip to my lou')).toBeNull();     // "skip" — would have been next
    expect(kindOf('play songs like coldplay')).toBeNull();// "like" — would have been a like
    expect(kindOf('put on some jazz')).toBeNull();
    expect(kindOf('listen to taylor swift')).toBeNull();
  });

  it('still recognises bare transport commands and "like this"', () => {
    expect(kindOf('next')).toBe('next');
    expect(kindOf('go back')).toBe('prev');
    expect(kindOf('like this')).toBe('like');
    expect(kindOf('songs like coldplay')).toBeNull();     // similarity, not a like
  });

  it('does NOT false-match a word that merely contains a command (boundaries)', () => {
    expect(kindOf('play background music')).toBeNull();   // "back" is inside "background"
    expect(kindOf('')).toBeNull();
    expect(kindOf(null)).toBeNull();
    expect(kindOf('what is the weather')).toBeNull();
  });
});

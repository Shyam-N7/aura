import { describe, it, expect } from 'vitest';
import { SCHEMA, sanitizeSuggestions } from './talk.js';

// Guards the talk contract: sanitizeSuggestions keeps the suggestion chips
// well-formed no matter what the model emits, and the response schema keeps
// the shape clients depend on (reply + action + suggestions, queue/none).
describe('sanitizeSuggestions', () => {
  it('returns [] for anything that is not an array', () => {
    expect(sanitizeSuggestions(undefined)).toEqual([]);
    expect(sanitizeSuggestions(null)).toEqual([]);
    expect(sanitizeSuggestions('more like this')).toEqual([]);
    expect(sanitizeSuggestions({ 0: 'more like this' })).toEqual([]);
  });

  it('drops blanks and non-strings', () => {
    expect(sanitizeSuggestions(['more like this', '', '   ', 42, null, 'switch to english']))
      .toEqual(['more like this', 'switch to english']);
  });

  it('clamps to 4 suggestions', () => {
    expect(sanitizeSuggestions(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeSuggestions(['  something more upbeat ', '\tplay from my likes\n']))
      .toEqual(['something more upbeat', 'play from my likes']);
  });
});

describe('talk response schema', () => {
  it('declares suggestions as an array of strings', () => {
    expect(SCHEMA.properties.suggestions).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('requires reply, action and suggestions', () => {
    expect(SCHEMA.required).toEqual(expect.arrayContaining(['reply', 'action', 'suggestions']));
  });

  it('keeps the action kind enum at exactly none|queue', () => {
    expect(SCHEMA.properties.action.properties.kind.enum).toEqual(['none', 'queue']);
  });
});

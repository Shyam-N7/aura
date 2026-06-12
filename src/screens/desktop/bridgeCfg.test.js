import { describe, it, expect, beforeEach } from 'vitest';
import { loadCfg, saveCfg } from './bridgeCfg';

beforeEach(() => localStorage.clear());

const put = (v) => localStorage.setItem('aura.moodBridge', JSON.stringify(v));

describe('bridge cfg migration', () => {
  it('gives legacy {from,to,steps} blobs an empty langs list (your mix)', () => {
    put({ from: 'sad', to: 'happy', steps: 5 });
    expect(loadCfg()).toEqual({ from: 'sad', to: 'happy', steps: 5, langs: [] });
  });

  it('clamps langs to two and drops unknown languages', () => {
    put({ from: 'tired', to: 'calm', steps: 6, langs: ['tamil', 'english', 'hindi'] });
    expect(loadCfg().langs).toEqual(['tamil', 'english']);
    put({ from: 'tired', to: 'calm', steps: 6, langs: ['klingon', 'tamil'] });
    expect(loadCfg().langs).toEqual(['tamil']);
  });

  it('resets stale vocabularies and corrupt JSON to defaults', () => {
    put({ from: 'calm', to: 'upbeat', steps: 5 });   // pre-rename mood words
    expect(loadCfg()).toEqual({ from: 'sad', to: 'happy', steps: 5, langs: [] });
    localStorage.setItem('aura.moodBridge', '{not json');
    expect(loadCfg()).toEqual({ from: 'sad', to: 'happy', steps: 5, langs: [] });
  });

  it('round-trips through saveCfg', () => {
    saveCfg({ from: 'restless', to: 'focused', steps: 4, langs: ['kannada'] });
    expect(loadCfg()).toEqual({ from: 'restless', to: 'focused', steps: 4, langs: ['kannada'] });
  });
});

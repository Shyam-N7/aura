import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getEqUserPresets, saveEqUserPreset, deleteEqUserPreset, subscribeEqUserPresets, MAX_PRESETS,
} from './eqPresets';

const FLAT = [0, 0, 0, 0, 0, 0, 0, 0];

beforeEach(() => localStorage.clear());

describe('eqPresets store', () => {
  it('starts empty and round-trips a saved preset', () => {
    expect(getEqUserPresets()).toEqual([]);
    const list = saveEqUserPreset('Late night', [1, 2, 3, 0, 0, 0, 0, 0]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Late night', gains: [1, 2, 3, 0, 0, 0, 0, 0] });
    expect(list[0].id).toBeTruthy();
    expect(getEqUserPresets()).toHaveLength(1);
  });

  it('trims the name and rejects blank ones', () => {
    expect(saveEqUserPreset('   ', FLAT)).toBeNull();
    const list = saveEqUserPreset('  Chill  ', FLAT);
    expect(list[0].name).toBe('Chill');
  });

  it('rejects case-insensitive duplicate names', () => {
    saveEqUserPreset('Warmth', [1, 0, 0, 0, 0, 0, 0, 0]);
    expect(saveEqUserPreset('warmth', [2, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(getEqUserPresets()).toHaveLength(1);
  });

  it('sanitizes gains (length, clamp, non-numbers)', () => {
    const [p] = saveEqUserPreset('Wild', [99, -99, 'x', null, 0, 0, 0, 0, 123]);
    expect(p.gains).toHaveLength(8);   // extra entry dropped, missing filled
    expect(p.gains[0]).toBe(12);       // clamped to +range
    expect(p.gains[1]).toBe(-12);      // clamped to -range
    expect(p.gains[2]).toBe(0);        // NaN → 0
  });

  it('caps the number of presets', () => {
    for (let i = 0; i < MAX_PRESETS; i++) saveEqUserPreset(`p${i}`, FLAT);
    expect(getEqUserPresets()).toHaveLength(MAX_PRESETS);
    expect(saveEqUserPreset('one too many', FLAT)).toBeNull();
  });

  it('deletes by id', () => {
    const list = saveEqUserPreset('Gone', [3, 0, 0, 0, 0, 0, 0, 0]);
    expect(deleteEqUserPreset(list[0].id)).toEqual([]);
    expect(getEqUserPresets()).toEqual([]);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('aura.eq.userPresets', '{not json');
    expect(getEqUserPresets()).toEqual([]);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const cb = vi.fn();
    const off = subscribeEqUserPresets(cb);
    saveEqUserPreset('A', FLAT);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    saveEqUserPreset('B', FLAT);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

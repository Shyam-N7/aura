import { describe, it, expect } from 'vitest';
import { dropExplicit } from './explicit';

describe('dropExplicit', () => {
  const list = [{ id: 1 }, { id: 2, explicit: true }, { id: 3, explicit: false }];

  it('removes explicit-flagged tracks when family mode is on', () => {
    expect(dropExplicit(list, true).map(t => t.id)).toEqual([1, 3]);
  });

  it('returns the list unchanged when family mode is off', () => {
    expect(dropExplicit(list, false)).toBe(list);
  });

  it('tolerates non-arrays', () => {
    expect(dropExplicit(null, true)).toEqual([]);
    expect(dropExplicit(undefined, false)).toEqual([]);
  });
});

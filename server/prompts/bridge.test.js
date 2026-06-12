import { describe, it, expect } from 'vitest';
import { SCHEMA, STAGE_LABELS, sanitizePlan } from './bridge.js';

// Guards the bridge-plan contract: the schema keeps the shape the planner
// depends on (narrative + per-step query/language/label), and sanitizePlan
// keeps the plan well-formed no matter what the model emits.
describe('bridge plan schema', () => {
  it('requires narrative and steps', () => {
    expect(SCHEMA.required).toEqual(expect.arrayContaining(['narrative', 'steps']));
  });

  it('requires query, language and label on every step', () => {
    expect(SCHEMA.properties.steps.items.required)
      .toEqual(expect.arrayContaining(['query', 'language', 'label']));
  });
});

describe('sanitizePlan', () => {
  const allowedLangs = ['tamil', 'english'];
  const step = (i, over = {}) => ({
    query: `query ${i}`, language: 'tamil', label: 'turning', ...over,
  });

  it('clamps 9 steps down to 6', () => {
    const plan = { narrative: 'n', steps: Array.from({ length: 9 }, (_, i) => step(i)) };
    const out = sanitizePlan(plan, { steps: 6, allowedLangs });
    expect(out.steps).toHaveLength(6);
    expect(out.steps[5].query).toBe('query 5');
  });

  it('pads 3 steps up to 6 with nulls', () => {
    const plan = { narrative: 'n', steps: [step(0), step(1), step(2)] };
    const out = sanitizePlan(plan, { steps: 6, allowedLangs });
    expect(out.steps).toHaveLength(6);
    expect(out.steps.slice(3)).toEqual([null, null, null]);
  });

  it('drops a language outside the allowed list', () => {
    const plan = { narrative: 'n', steps: [step(0, { language: 'spanish' })] };
    const out = sanitizePlan(plan, { steps: 4, allowedLangs });
    expect(out.steps[0].language).toBeUndefined();
  });

  it('keeps an allowed language, lowercased', () => {
    const plan = { narrative: 'n', steps: [step(0, { language: ' Tamil ' })] };
    const out = sanitizePlan(plan, { steps: 4, allowedLangs });
    expect(out.steps[0].language).toBe('tamil');
  });

  it('lowercases labels to their first word and defaults missing ones', () => {
    const plan = {
      narrative: 'n',
      steps: [
        step(0, { label: 'Settling In Gently' }),
        step(1, { label: 42 }),
        step(2, { label: '' }),
        step(3),
      ],
    };
    const out = sanitizePlan(plan, { steps: 4, allowedLangs });
    expect(out.steps[0].label).toBe('settling');
    expect(out.steps[1].label).toBe(STAGE_LABELS[4][1]);
    expect(out.steps[2].label).toBe(STAGE_LABELS[4][2]);
    expect(out.steps[3].label).toBe('turning');
  });

  it('nulls out entries without a usable query', () => {
    const plan = { narrative: 'n', steps: [step(0, { query: '   ' }), step(1, { query: 7 })] };
    const out = sanitizePlan(plan, { steps: 4, allowedLangs });
    expect(out.steps[0]).toBeNull();
    expect(out.steps[1]).toBeNull();
  });

  it.each([null, undefined, 'garbage', 42, { steps: 'nope' }, { narrative: 9, steps: {} }])(
    'survives garbage input %#',
    (input) => {
      expect(sanitizePlan(input, { steps: 5, allowedLangs }))
        .toEqual({ narrative: '', steps: [null, null, null, null, null] });
    },
  );

  it('trims the narrative and defaults it to an empty string', () => {
    expect(sanitizePlan({ narrative: '  a slow walk up  ', steps: [] }, { steps: 4, allowedLangs }).narrative)
      .toBe('a slow walk up');
    expect(sanitizePlan({ steps: [] }, { steps: 4, allowedLangs }).narrative).toBe('');
  });
});

describe('STAGE_LABELS', () => {
  it('covers 4..8 steps with matching lengths and distinct adjacent labels', () => {
    for (const n of [4, 5, 6, 7, 8]) {
      expect(STAGE_LABELS[n]).toHaveLength(n);
      for (let i = 1; i < n; i++) {
        expect(STAGE_LABELS[n][i]).not.toBe(STAGE_LABELS[n][i - 1]);
      }
    }
  });
});

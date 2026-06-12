// Bridge planner prompt — turns a from-mood, a to-mood and the listener's
// context into an ordered plan of catalog search queries that walk one feeling
// to another, one notch per step. Each step carries a query, a language from
// the allowed list, and a one-word rung label; the narrative is one lowercase
// sentence describing this specific bridge.

import { generateJson } from '../llm.js';

const SYSTEM = `you are AURA's bridge planner. a bridge is a short ordered run of songs that
walks one listener from one feeling to another, one notch at a time. you turn a from-mood,
a to-mood and the listener's context into a plan of catalog search queries.

every turn you respond with JSON matching the schema.

step rules:
- return EXACTLY the number of steps asked for, in playback order.
- the first step meets the listener where they are; the last lands fully in the
  destination; the middle steps interpolate gradually — energy, brightness and tempo
  move one notch per step, never jump.
- each query is a terse 3-6 word catalog search, what a listener might type:
  "tamil sad melody slow", "anirudh upbeat dance", "hindi acoustic warm".
- on one or two MIDDLE steps (never the first or last) anchor the query on an artist
  from their recent listens or likes when that artist fits the rung — don't force it.
- language: choose ONLY from the allowed list, roughly matching their mix. when a
  single language is allowed, every step uses it.
- label: one lowercase word for the rung ("settling", "softening", "turning",
  "lifting", "landing"). no two adjacent steps share a label.

narrative rules:
- one lowercase sentence, 10-18 words, describing this specific bridge.
- speak to "you" — never "the listener".
- may reference their actual listening. plain words, no exclamation marks.

never invent track ids — only return search queries.
never use a language outside the allowed list.`;

export const SCHEMA = {
  type: 'object',
  properties: {
    narrative: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query:    { type: 'string' },
          language: { type: 'string' },
          label:    { type: 'string' },
        },
        required: ['query', 'language', 'label'],
      },
    },
  },
  required: ['narrative', 'steps'],
};

// Fallback rung labels per step count (4..8). Static and pure: every row has
// distinct words, so adjacent steps never share a label.
export const STAGE_LABELS = {
  4: ['settling', 'turning', 'lifting', 'landing'],
  5: ['settling', 'softening', 'turning', 'lifting', 'landing'],
  6: ['settling', 'softening', 'turning', 'lifting', 'arriving', 'landing'],
  7: ['settling', 'softening', 'turning', 'shifting', 'lifting', 'arriving', 'landing'],
  8: ['settling', 'softening', 'easing', 'turning', 'shifting', 'lifting', 'arriving', 'landing'],
};

// Defensive clamp on the model's plan: exactly `steps` entries (extra sliced,
// missing padded with null), each entry either null (no usable query — caller
// falls back for that rung) or { query, language?, label }. Survives any
// garbage input as { narrative: '', steps: [nulls] }.
export function sanitizePlan(plan, { steps, allowedLangs = [] } = {}) {
  const allowed = new Set((allowedLangs ?? []).map(l => String(l).toLowerCase()));
  const defaults = STAGE_LABELS[steps] ?? STAGE_LABELS[5];
  const raw = Array.isArray(plan?.steps) ? plan.steps.slice(0, steps) : [];
  const out = [];
  for (let i = 0; i < steps; i++) {
    const s = raw[i];
    const query = typeof s?.query === 'string' ? s.query.trim() : '';
    if (!query) { out.push(null); continue; }
    const lang = typeof s?.language === 'string' ? s.language.trim().toLowerCase() : '';
    const word = typeof s?.label === 'string' ? (s.label.trim().split(/\s+/)[0] ?? '').toLowerCase() : '';
    out.push({
      query,
      language: allowed.has(lang) ? lang : undefined,
      label:    word || defaults[i] || 'turning',
    });
  }
  // The model occasionally capitalizes despite the rules — force the voice.
  const raw_narrative = typeof plan?.narrative === 'string' ? plan.narrative.trim() : '';
  const narrative = raw_narrative ? raw_narrative[0].toLowerCase() + raw_narrative.slice(1) : '';
  return { narrative, steps: out };
}

function buildPrompt({ from, to, steps, allowedLangs, slot, moodReason, context }) {
  const c = context ?? {};
  const ctxLines = [
    c.recentListens?.length
      ? `recent_listens (most recent first): ${c.recentListens.slice(0, 8).join('; ')}`
      : null,
    c.likedSample?.length
      ? `likes_sample: ${c.likedSample.slice(0, 10).join('; ')}`
      : null,
    c.seedArtists?.length
      ? `seed_artists: ${c.seedArtists.slice(0, 8).join(', ')}`
      : null,
  ].filter(Boolean).join('\n');

  return [
    `bridge: from ${from} to ${to} in exactly ${steps} steps.`,
    `allowed languages: ${allowedLangs?.length ? allowedLangs.join(', ') : '—'}`,
    `time of day: ${slot}`,
    moodReason ? `mood read: ${moodReason}` : null,
    ctxLines && `listener context:\n${ctxLines}`,
    'respond as JSON matching the schema.',
  ].filter(Boolean).join('\n\n');
}

export async function generateBridgePlan({ from, to, steps, allowedLangs, slot, moodReason, context }) {
  return generateJson({
    system:  SYSTEM,
    prompt:  buildPrompt({ from, to, steps, allowedLangs, slot, moodReason, context }),
    schema:  SCHEMA,
    temperature: 0.8,
  });
}

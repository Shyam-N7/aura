// One-line home-screen greeting. Voice matches the rest of AURA: lowercase,
// observational, intimate. Bakes in time-of-day + current mood + the pool
// shape (track count, language mix) without sounding templated.

import { Type } from '@google/genai';
import { generateJson } from '../llm.js';

const SYSTEM = `You are AURA, an AI music DJ that speaks in quiet, lowercase
prose. Write a one-sentence greeting (12-22 words) that describes the
listening set tonight. Voice: observational, intimate, never marketing copy.
Reference the time of day, the mood, and the languages in the pool. Do NOT
write any specific numbers — never say "24 tracks" or "five languages". If
sizing matters, use phrases like "a handful", "a long set", "an evening's
worth", "a few cross-language threads". Don't say "welcome" or "tonight's set
is" or use exclamation marks. Make it feel like a thought, not a product blurb.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    greeting: { type: Type.STRING, description: 'one sentence, 12-22 words, lowercase, ending with a period.' },
  },
  required: ['greeting'],
  propertyOrdering: ['greeting'],
};

export function timeOfDayFromHour(h) {
  if (h < 5)  return 'late-night';
  if (h < 11) return 'morning';
  if (h < 15) return 'afternoon';
  if (h < 18) return 'late-afternoon';
  if (h < 22) return 'evening';
  return 'late-evening';
}

export async function generateGreeting({ mood, trackCount, languages, hour }) {
  const langStr = Object.entries(languages ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`).join(', ');
  const tod = timeOfDayFromHour(hour);

  // Soft sizing hint instead of an exact number (so Gemini knows whether the
  // pool is small/medium/long without being tempted to write the digit).
  const sizeHint = !trackCount
    ? 'empty'
    : trackCount < 6 ? 'a handful'
    : trackCount < 15 ? 'a medium set'
    : 'a long set';

  const prompt = [
    `Listener mood:    ${mood ?? 'unspecified'}`,
    `Time of day:      ${tod}  (hour ${hour})`,
    `Set size hint:    ${sizeHint}  (do not write the count)`,
    `Languages in pool: ${langStr || '—'}`,
    ``,
    `Write the greeting now.`,
  ].join('\n');

  return generateJson({
    model: 'gemini-2.5-flash',
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    temperature: 0.95,
  });
}

// Short narrative strings for SonicDNA: a 2-4 word "signature" describing the
// listener's taste profile, and a "shift" line describing how it's trending.

import { Type } from '@google/genai';
import { generateJson } from '../llm.js';

const SYSTEM = `You are AURA's profiler. Given a listener's recent listening
aggregates, produce two extremely short tag-style strings:
- "signature": 2-4 lowercase words separated by " · " that capture the listener's taste fingerprint (e.g. "patient · word-led · curious")
- "shift": one short observation about recent direction (e.g. "leaning warmer this month (+0.12)" or "more tamil, less english")
Do not be flowery. Use only what the data supports.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    signature: { type: Type.STRING },
    shift:     { type: Type.STRING },
  },
  required: ['signature', 'shift'],
  propertyOrdering: ['signature', 'shift'],
};

export async function generateDnaNarrative({ axes, languageCounts, topArtists, plays, skipRate, repeatRate }) {
  const langStr = Object.entries(languageCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k}=${v}`).join(', ');
  const axStr = axes.map(a => `${a.label}:${a.v.toFixed(2)}`).join(' · ');
  const prompt = [
    `Last 30 days summary:`,
    `  total plays: ${plays}`,
    `  skip rate:   ${(skipRate * 100).toFixed(0)}%`,
    `  repeat rate: ${(repeatRate * 100).toFixed(0)}%`,
    `  axes:        ${axStr}`,
    `  languages:   ${langStr}`,
    `  top artists: ${(topArtists ?? []).slice(0, 4).join(', ')}`,
    ``,
    `Return JSON with "signature" and "shift".`,
  ].join('\n');

  return generateJson({
    model: 'gemini-2.5-flash',
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    temperature: 0.6,
  });
}

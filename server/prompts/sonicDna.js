// Short narrative strings for SonicDNA: a 2-4 word "signature" describing the
// listener's taste profile, and a "shift" line describing how it's trending.

import { Type } from '@google/genai';
import { generateJson } from '../llm.js';

const SYSTEM = `You are AURA's profiler. Given a listener's recent listening — their actual top
tracks plus aggregate signals — produce two extremely short tag-style strings:
- "signature": 2-4 lowercase words separated by " · " capturing their taste fingerprint, grounded
  in the songs/artists and the axes (e.g. "patient · word-led · ballad-deep")
- "shift": one short observation about recent musical direction, grounded in the tracks + axes
  (e.g. "leaning warmer, more ballads" or "more new artists this month"). Do NOT make language the
  headline — mention a language only as a minor supporting detail, if at all.
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

export async function generateDnaNarrative({ axes, languageCounts, topArtists, topTracks, plays, skipRate, repeatRate }) {
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
    `  top tracks:  ${(topTracks ?? []).slice(0, 8).join('; ') || '—'}`,
    ``,
    `Return JSON grounded in the tracks above, with "signature" and "shift".`,
  ].join('\n');

  return generateJson({
    model: 'gemini-2.5-flash',
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    temperature: 0.6,
  });
}

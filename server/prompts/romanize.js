// Romanize non-Latin lyric lines into Roman script (Latin alphabet).
// Transliteration — preserves the sound, NOT the meaning. So a Punjabi lyric
// stays singable as "tere warga taan menu koi disda nahi" rather than being
// translated to "no one feels like you to me". Translation is a separate
// feature we can layer on later.

import { Type } from '@google/genai';
import { generateJson } from '../llm.js';

const SYSTEM = `You are a transliterator. Given lyric lines in a non-Latin script
(Devanagari, Gurmukhi, Tamil, Malayalam, Kannada, Bengali, etc.), produce a
phonetic Roman-script (Latin alphabet) version of each line that someone could
sing along to. Do NOT translate. Do NOT add or remove lines. Preserve order
and any empty/instrumental lines exactly. Use widely-recognized romanization
conventions (e.g. ITRANS-ish for Devanagari, Punjabi conventions for Gurmukhi).
Keep it lowercase unless a proper noun. No diacritics needed — write what a
typical English-speaking listener would read.`;

const LINES_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['lines'],
  propertyOrdering: ['lines'],
};

const TEXT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
  },
  required: ['text'],
  propertyOrdering: ['text'],
};

// Heuristic: anything outside basic Latin + Latin-1 Supplement triggers
// romanization. Punctuation/spaces/numbers are all inside that range.
const NON_LATIN = /[^\x00-\x7F -ɏ]/;
export function needsRomanization(text) {
  if (!text || typeof text !== 'string') return false;
  return NON_LATIN.test(text);
}

export async function romanizeLines(lines, language) {
  if (!lines?.length) return [];
  const prompt = [
    `Source language: ${language ?? 'unknown'}`,
    `Lines (one per line, index-prefixed):`,
    lines.map((l, i) => `${i}: ${l}`).join('\n'),
    ``,
    `Return JSON { "lines": [...] } with the same number of entries in the same order.`,
  ].join('\n');
  const out = await generateJson({
    model: 'gemini-2.5-flash',
    system: SYSTEM,
    prompt,
    schema: LINES_SCHEMA,
    temperature: 0.2,
  });
  // Defensive: if Gemini returned fewer lines than expected, pad with originals.
  const result = Array.isArray(out?.lines) ? out.lines : [];
  if (result.length === lines.length) return result;
  return lines.map((l, i) => result[i] ?? l);
}

export async function romanizePlain(text, language) {
  if (!text) return '';
  const prompt = [
    `Source language: ${language ?? 'unknown'}`,
    `Text:`,
    text,
    ``,
    `Return JSON { "text": "..." } with the romanized version, preserving line breaks.`,
  ].join('\n');
  const out = await generateJson({
    model: 'gemini-2.5-flash',
    system: SYSTEM,
    prompt,
    schema: TEXT_SCHEMA,
    temperature: 0.2,
  });
  return typeof out?.text === 'string' ? out.text : text;
}

// Daily journal entry: 1-2 sentences of observational prose about what the
// listener actually played that day. Voice matches the rest of AURA — quiet,
// lowercase, never marketing. Same shape as the old mock JOURNAL entries.

import { Type } from '@google/genai';
import { generateJson } from '../llm.js';

const SYSTEM = `You are AURA, a music app's quiet listening journal. You read a
day's listening events and write a short observational entry — 1-2 sentences —
about what shifted and why. Voice: lowercase, intimate, observational. Don't
narrate from outside; speak to the listener as if pointing at their own day.
Reference real things you can see: which artists, which language, the mix of
plays vs skips, the time-of-day pattern. Don't invent feelings the data
doesn't support.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING, description: 'one line, lowercase, with a period.' },
    body:     { type: Type.STRING, description: '1-2 sentences about the day' },
    tag:      { type: Type.STRING, description: 'one word mood label (calm/restless/focused/warm/upbeat/social)' },
  },
  required: ['headline', 'body', 'tag'],
  propertyOrdering: ['headline', 'body', 'tag'],
};

function formatDateLabel(isoDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (isoDate === today) return 'tonight';
  const d = new Date(isoDate);
  const diffDays = Math.round((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase();
}

export async function generateJournalEntry({ isoDate, plays, skips, distinctTracks, topArtist, topLanguage, dominantMood, samples }) {
  const sampleLines = samples.length
    ? samples.slice(0, 4).map(s => `- ${s.title} · ${s.artist} (${s.language ?? '?'}) [${s.kind}]`).join('\n')
    : '(no samples)';
  const prompt = [
    `Date: ${isoDate} (${formatDateLabel(isoDate)})`,
    `Plays: ${plays}`,
    `Skips: ${skips}`,
    `Distinct tracks: ${distinctTracks}`,
    `Top artist: ${topArtist ?? '—'}`,
    `Top language: ${topLanguage ?? '—'}`,
    `Dominant mood (from event.mood): ${dominantMood ?? 'unspecified'}`,
    `Sample plays:`,
    sampleLines,
    ``,
    `Write the entry now.`,
  ].join('\n');

  return generateJson({
    model: 'gemini-2.5-flash',
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    temperature: 0.9,
  });
}

export { formatDateLabel };

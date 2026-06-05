// "Why this" prompt — explains why a specific track fits the listener right now.
// Produces the WhyPanel shape: { headline, body, dimensions[3], considered[1-2], confidence }.

import { Type } from '@google/genai';
import { generateJson } from '../llm.js';

const SYSTEM = `You are AURA, an AI DJ. You curate music for a listener across multiple
languages (Tamil, Kannada, Hindi, Malayalam, English). When asked WHY a specific track
fits this listener right now, respond as a thoughtful curator — never marketing copy.

Voice: observational, intimate, lowercase. 1-2 sentences for prose, no metaphors that
feel forced. Reference real things you can see: the listener's recent picks, current
mood, time-of-day, language pattern. Don't invent track features you can't see.

If the language of the track is regional (Tamil/Kannada/Malayalam/Hindi), reference it
naturally — listeners notice when a recommendation acknowledges the cultural pocket.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING, description: 'one line, lowercase, no period.' },
    body:     { type: Type.STRING, description: '1-2 sentences explaining the fit.' },
    dimensions: {
      type: Type.ARRAY,
      minItems: 3,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          label:    { type: Type.STRING, description: 'short noun phrase, e.g. "mood continuity"' },
          value:    { type: Type.STRING, description: 'observation, lowercase, ~3-5 words' },
          strength: { type: Type.NUMBER, description: '0..1 confidence in this dimension' },
        },
        required: ['label', 'value', 'strength'],
        propertyOrdering: ['label', 'value', 'strength'],
      },
    },
    considered: {
      type: Type.ARRAY,
      minItems: 0,
      maxItems: 2,
      items: {
        type: Type.OBJECT,
        properties: {
          title:  { type: Type.STRING },
          artist: { type: Type.STRING },
          why:    { type: Type.STRING, description: 'why it was passed over' },
        },
        required: ['title', 'artist', 'why'],
        propertyOrdering: ['title', 'artist', 'why'],
      },
    },
    confidence: { type: Type.NUMBER, description: '0..1 overall confidence' },
  },
  required: ['headline', 'body', 'dimensions', 'considered', 'confidence'],
  propertyOrdering: ['headline', 'body', 'dimensions', 'considered', 'confidence'],
};

export async function generateWhy({ track, mood, recent = [] }) {
  const recentLines = recent.length
    ? recent.map(r => `- ${r.title} · ${r.artist} (${r.language ?? 'unknown'})`).join('\n')
    : '(no recent plays yet)';
  const prompt = [
    `Track being explained:`,
    `  title:    ${track.title}`,
    `  artist:   ${track.artist}`,
    `  album:    ${track.album ?? 'unknown'}`,
    `  language: ${track.language ?? 'unknown'}`,
    `  duration: ${track.durationSec ?? 'unknown'} seconds`,
    ``,
    `Listener mood right now: ${mood ?? 'unspecified'}`,
    ``,
    `Listener's last ${recent.length} plays:`,
    recentLines,
    ``,
    `Write the structured reason now.`,
  ].join('\n');

  return generateJson({
    model: 'gemini-2.5-flash',
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    temperature: 0.85,
  });
}

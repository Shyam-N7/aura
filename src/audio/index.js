import { SimulatedAudioPlayer } from './SimulatedAudioPlayer';
import { HtmlAudioPlayer } from './HtmlAudioPlayer';

// Default to 'html' — real audio via HTMLAudioElement, fed by track.streamUrl
// from the catalog. Pass { kind: 'sim' } to fall back to the
// setInterval-based simulator (useful for tests with no audio fixture).
/**
 * @param {{ kind?: 'html' | 'sim' }} [options]
 * @returns {import('./AudioPlayer').AudioPlayer}
 */
export function createAudioPlayer({ kind = 'html' } = {}) {
  return kind === 'sim' ? new SimulatedAudioPlayer() : new HtmlAudioPlayer();
}

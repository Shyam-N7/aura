import { useRef, useEffect } from 'react';
import { createAudioPlayer } from '../audio';

// Single AudioPlayer instance per consumer; destroyed on unmount.
// Pass { kind: 'sim' | 'html' } to choose implementation.
/**
 * @param {{ kind?: 'html' | 'sim' }} [options]
 * @returns {import('../audio/AudioPlayer').AudioPlayer}
 */
export function useAudioPlayer(options) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createAudioPlayer(options);
  useEffect(() => () => ref.current?.destroy(), []);
  return ref.current;
}

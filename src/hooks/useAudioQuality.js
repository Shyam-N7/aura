import { useEffect, useState } from 'react';
import { getAudioQuality, setAudioQuality, subscribeAudioQuality } from '../lib/audioQuality';

// Read + write the audio-quality preference, kept in sync across every surface
// that uses it (settings panel, equalizer popup) via the shared subscription.
export function useAudioQuality() {
  const [quality, setQuality] = useState(getAudioQuality);
  useEffect(() => subscribeAudioQuality(setQuality), []);
  return [quality, setAudioQuality];
}

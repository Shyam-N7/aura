import { useEffect, useRef, useState } from 'react';
import { LandingAudio } from './LandingAudio';

// Owns the hero's generative audio. Lazily creates the engine on first play (a
// user gesture), exposes the analyser so the orb (and later spotlights) can react.
export function useHeroOrbAudio() {
  const ref = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [analyser, setAnalyser] = useState(null);

  const busy = useRef(false);   // guards the async first play() against rapid double-clicks

  useEffect(() => () => { ref.current?.destroy(); ref.current = null; }, []);

  const toggle = async () => {
    if (!ref.current) ref.current = new LandingAudio();
    if (isPlaying) {
      ref.current.pause();
      setIsPlaying(false);
      return;
    }
    if (busy.current) return;   // a play() is already in flight — ignore the duplicate click
    busy.current = true;
    try {
      const ok = await ref.current.play();
      if (ok) {
        setAnalyser(ref.current.getAnalyser());
        setIsPlaying(true);
      }
    } finally {
      busy.current = false;
    }
  };

  return { isPlaying, analyser, toggle };
}

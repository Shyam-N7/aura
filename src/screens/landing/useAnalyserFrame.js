import { useEffect, useRef } from 'react';
import gsap from 'gsap';

// Shared per-frame pump for landing spotlights that react to the hero's audio.
// While `isPlaying` and the target element is on-screen, it reads the hero
// AnalyserNode on the single gsap.ticker (~30fps, same cadence as the orb) and
// hands the caller the byte-frequency buffer + a smoothed 0..1 average. It no-ops
// entirely under reduced motion or while the hero audio is idle, so each
// spotlight keeps its own CSS/GSAP behavior unless the visitor pressed "feel it".
// onStart / onStop let the caller swap into and back out of its audio-driven
// state cleanly (e.g. pause an idle tween, then restore it).
export function useAnalyserFrame(elRef, analyser, isPlaying, handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const el = elRef.current;
    if (!analyser || !isPlaying || !el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(el);

    const buf = new Uint8Array(analyser.frequencyBinCount);
    let level = 0;
    let tick = 0;
    ref.current?.onStart?.();

    const render = () => {
      if (document.hidden || !visible) return;
      if (++tick % 2) return;                       // ~30fps
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      level += ((sum / buf.length / 255) - level) * 0.18;   // smooth toward target
      ref.current?.onFrame?.(buf, level);
    };
    gsap.ticker.add(render);

    return () => {
      gsap.ticker.remove(render);
      io.disconnect();
      ref.current?.onStop?.();
    };
  }, [elRef, analyser, isPlaying]);
}

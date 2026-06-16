import { useRef, useState } from 'react';
import gsap from 'gsap';
import { QuickPicksOrbit } from '../../desktop/QuickPicksOrbit';
import { ORBIT_TRACKS } from '../showcaseData';
import { useGsap } from '../useGsap';
import { useAnalyserFrame } from '../useAnalyserFrame';

// Two scoped touches on the real QuickPicksOrbit (component untouched):
//  • Discs spring in when the band is reached. Their own CSS pop fires off-screen
//    at page load, so it's never seen — this re-pops them on scroll. The discs'
//    hover transition is suppressed during the tween, then inline props are
//    cleared so positioning (translate -50%,-50%) and hover return to CSS.
//  • A gentle continuous "breath" of the whole constellation (no spin — that
//    would flip the labels). Paused while off-screen.
function orbitAnim({ gsap, q, root }) {
  const discs = q('.aura-qpo__disc');
  if (discs.length) {
    gsap.set(discs, { transition: 'none' });
    gsap.from(discs, {
      scale: 0, opacity: 0, transformOrigin: 'center center',
      duration: 0.55, stagger: 0.07, ease: 'back.out(2.2)',
      clearProps: 'transform,opacity,transition',
      scrollTrigger: { trigger: root, start: 'top 75%', once: true },
    });
  }
  const ring = q('.aura-qpo__ring')[0];
  if (ring) {
    gsap.to(ring, {
      scale: 1.03, transformOrigin: 'center center',
      duration: 6, ease: 'sine.inOut', yoyo: true, repeat: -1,
      scrollTrigger: { trigger: ring, start: 'top bottom', end: 'bottom top',
        toggleActions: 'play pause resume pause' },
    });
  }
}

// Spotlight: the REAL quick-picks orbital ring. Hover/focus a disc to lift it
// and show its name in the hub; the hub shuffles. No playback — onPlay is a
// no-op, onShuffle just re-orders the discs.
export function OrbitSpotlight({ analyser, isPlaying }) {
  const [tracks, setTracks] = useState(ORBIT_TRACKS);
  const ref = useRef(null);
  useGsap(ref, orbitAnim);

  // While the hero pad plays, the ring pulses to the audio instead of its idle
  // GSAP "breath": suspend that tween (and its ScrollTrigger so a scroll can't
  // resume it mid-pulse), drive scale from the level, restore everything on stop.
  useAnalyserFrame(ref, analyser, isPlaying, {
    onStart: () => {
      const ring = ref.current?.querySelector('.aura-qpo__ring');
      if (ring) gsap.getTweensOf(ring).forEach((tw) => { tw.scrollTrigger?.disable(false); tw.pause(); });
    },
    onFrame: (_buf, level) => {
      const ring = ref.current?.querySelector('.aura-qpo__ring');
      if (ring) gsap.set(ring, { scale: 1 + level * 0.15, transformOrigin: 'center center' });
    },
    onStop: () => {
      const ring = ref.current?.querySelector('.aura-qpo__ring');
      if (!ring) return;
      gsap.set(ring, { clearProps: 'scale' });
      gsap.getTweensOf(ring).forEach((tw) => {
        const st = tw.scrollTrigger;
        if (!st) { tw.resume(); return; }
        st.enable();
        st.update();                    // enable() skips update() on re-enable — force a position read
        if (st.isActive) tw.resume();   // in view → resume the breath; off-screen → toggleActions resumes on scroll-in
      });
    },
  });

  const shuffle = () => setTracks((cur) => [...cur].sort(() => Math.random() - 0.5));
  return (
    <div className="lp-orbit" ref={ref}>
      <QuickPicksOrbit tracks={tracks} onPlay={() => {}} onShuffle={shuffle} />
    </div>
  );
}

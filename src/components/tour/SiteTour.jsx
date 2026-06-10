import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { markTourSeen } from '../../lib/tour';
import './SiteTour.css';

// First-run site tour. A spotlight (rounded cutout over a scrim) walks the user
// through the persistent chrome — each step introduces one page or feature with
// a line of plain copy. Every exit (finish, skip, Esc, breakpoint flip) marks
// the tour seen, so it shows exactly once per device.
//
// Steps: { id, screen, selector|null, title, body, scroll? }
//  - selector null → centered card, no spotlight (welcome/done).
//  - a missing anchor (collapsed rail etc.) silently skips the step.
//  - screen ≠ current → onNav(screen) first, then wait for the anchor.

const DESKTOP_STEPS = [
  { id: 'welcome', screen: 'home', selector: null,
    title: 'hey, welcome to aura', body: 'a 30-second look around. skip anytime.' },
  { id: 'search', screen: 'home', selector: "[data-tour='nav-search']",
    title: 'search', body: 'find any song, artist, album, or movie — or just type a feeling.' },
  { id: 'talk', screen: 'home', selector: "[data-tour='nav-talk']",
    title: 'ask aura', body: 'chat with your dj — say "something soft for a rainy evening" and it queues the set.' },
  { id: 'library', screen: 'home', selector: "[data-tour='nav-library']",
    title: 'your library', body: 'likes, playlists, and everything you’ve been listening to.' },
  { id: 'study', screen: 'home', selector: "[data-tour='nav-study']",
    title: 'study your listening', body: 'journal, sonic dna, and mood bridges — how your music maps your days.' },
  { id: 'rail', screen: 'home', selector: '.aura-desktop-rail',
    title: 'now playing', body: 'whatever’s on lives here — queue, lyrics, equalizer, and why aura picked it.' },
  { id: 'mood', screen: 'home', selector: '.aura-nav-rail__signal',
    title: 'aura’s read', body: 'aura senses your mood from how you listen — watch it drift through the day.' },
  { id: 'done', screen: 'home', selector: null,
    title: 'that’s the room', body: 'press ? for shortcuts anytime. enjoy the music.' },
];

const MOBILE_STEPS = [
  { id: 'welcome', screen: 'home', selector: null,
    title: 'hey, welcome to aura', body: 'a quick look around — takes half a minute.' },
  { id: 'm-search', screen: 'home', selector: "[data-tour='mtop-search']",
    title: 'search', body: 'tap the top bar to find songs, artists, albums — or a feeling.' },
  { id: 'm-talk', screen: 'home', selector: "[data-tour='mnav-talk']",
    title: 'talk', body: 'ask aura for a vibe in plain words — it queues the right set.' },
  { id: 'm-library', screen: 'home', selector: "[data-tour='mnav-library']",
    title: 'you', body: 'your likes, playlists, and recents live here.' },
  { id: 'm-study', screen: 'home', selector: '.aura-dh__about-card', scroll: true,
    title: 'study your listening', body: 'journal, sonic dna, and mood bridges — all here on home.' },
  { id: 'm-np', screen: 'home', selector: "[data-tour='mnav-np']",
    title: 'now playing', body: 'your music sits here — tap it for the full player.' },
  { id: 'm-theme', screen: 'home', selector: '.aura-mobile-top__theme',
    title: 'day & night', body: 'flip the look whenever the light changes.' },
  { id: 'done', screen: 'home', selector: null,
    title: 'that’s it', body: 'go play something. aura’s listening.' },
];

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// rAF-poll for a selector until it exists and has real size. Resolves the
// element, `null` for selector-less steps, or `undefined` on timeout (missing).
function waitForAnchor(selector, { timeout = 1500 } = {}) {
  return new Promise((resolve) => {
    if (!selector) { resolve(null); return; }
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect?.();
      if (r && r.width > 8 && r.height > 8) { resolve(el); return; }
      if (performance.now() - t0 > timeout) { resolve(undefined); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

const PAD = 8;      // spotlight inflation around the anchor
const GAP = 14;     // card distance from the spotlight
const MARGIN = 16;  // viewport clamp

export function SiteTour({ surface, screen, onNav, onClose }) {
  const steps = surface === 'mobile' ? MOBILE_STEPS : DESKTOP_STEPS;
  const [idx, setIdx] = useState(0);
  // Measured spotlight rect, keyed by the step it was measured FOR — deriving
  // `rect` this way means a step change needs no synchronous state reset (the
  // stale hit simply stops matching). undefined = measuring (card hidden),
  // null = centered step, object = spotlight rect.
  const [hit, setHit] = useState({ forIdx: -1, value: undefined });
  const rect = hit.forIdx === idx ? hit.value : undefined;
  const [cardPos, setCardPos] = useState(null);
  const cardRef = useRef(null);
  const anchorRef = useRef(null);
  const seqRef = useRef(0);         // invalidates in-flight anchor waits
  const dirRef = useRef(1);         // travel direction for skip-on-missing
  const idxRef = useRef(idx); idxRef.current = idx;
  const onNavRef = useRef(onNav); onNavRef.current = onNav;
  const screenRef = useRef(screen); screenRef.current = screen;

  const finish = useCallback(() => { markTourSeen(); onClose(); }, [onClose]);

  // Breakpoint flip mid-tour → the step list no longer matches the chrome.
  // Exit terminally rather than restarting on the other surface.
  const surfaceAtMount = useRef(surface);
  useEffect(() => {
    if (surface !== surfaceAtMount.current) finish();
  }, [surface, finish]);

  const step = steps[Math.max(0, Math.min(idx, steps.length - 1))];

  // Step engine: (navigate →) wait for anchor → scroll → measure (+ settle
  // re-checks so screen-in animations and smooth scrolls land before we trust
  // the rect). A missing anchor advances silently in the travel direction.
  useEffect(() => {
    const seq = ++seqRef.current;
    const timers = [];
    anchorRef.current = null;
    if (step.screen && screenRef.current !== step.screen) onNavRef.current?.(step.screen);
    waitForAnchor(step.selector).then((el) => {
      if (seq !== seqRef.current) return;
      if (el === undefined) {
        const nextIdx = idx + dirRef.current;
        if (nextIdx < 0 || nextIdx >= steps.length) finish();
        else setIdx(nextIdx);
        return;
      }
      anchorRef.current = el;
      if (el && step.scroll) {
        el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      const measure = () => {
        if (seq !== seqRef.current) return;
        const a = anchorRef.current;
        const r = a?.getBoundingClientRect?.();
        setHit({ forIdx: idx, value: a && r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null });
      };
      measure();
      for (const ms of [120, 360, 720]) timers.push(setTimeout(measure, ms));
    });
    return () => { timers.forEach(clearTimeout); };
    // steps identity is stable per surface; idx is the real driver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, steps]);

  // Keep the spotlight glued to its anchor through resizes and inner scrolls.
  useEffect(() => {
    const onMove = () => {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      setHit({ forIdx: idxRef.current, value: r.width > 4 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null });
    };
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', onMove);
      document.removeEventListener('scroll', onMove, { capture: true });
    };
  }, []);

  // Place the card once the rect is known: below the spotlight, else above,
  // else centered; clamped to the viewport. While measuring (rect undefined)
  // the stale position is left in place — the card is visibility:hidden then,
  // and this re-runs before paint as soon as the new rect lands.
  useLayoutEffect(() => {
    if (rect === undefined) return;
    const card = cardRef.current;
    if (!card) return;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!rect) {
      setCardPos({ top: Math.max(MARGIN, vh / 2 - ch / 2), left: Math.max(MARGIN, vw / 2 - cw / 2) });
      return;
    }
    let top = rect.top + rect.height + PAD + GAP;
    if (top + ch > vh - MARGIN) top = rect.top - PAD - GAP - ch;
    if (top < MARGIN) top = Math.max(MARGIN, Math.min(vh - ch - MARGIN, vh / 2 - ch / 2));
    let left = rect.left + rect.width / 2 - cw / 2;
    left = Math.max(MARGIN, Math.min(left, vw - cw - MARGIN));
    setCardPos({ top, left });
  }, [rect]);

  // Focus the card per step so keyboard + screen-reader users follow along.
  useEffect(() => {
    if (rect !== undefined) cardRef.current?.focus({ preventScroll: true });
  }, [rect, idx]);

  // Esc skips from anywhere (focus may sit outside the card).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [finish]);

  const goNext = () => {
    dirRef.current = 1;
    if (idx >= steps.length - 1) finish();
    else setIdx(idx + 1);
  };
  const goBack = () => {
    if (idx === 0) return;
    dirRef.current = -1;
    setIdx(idx - 1);
  };

  // Tab cycles within the card's buttons (a real trap — the dialog floats over
  // an app that's otherwise click-blocked).
  const trapTab = (e) => {
    if (e.key !== 'Tab') return;
    const items = cardRef.current?.querySelectorAll('button');
    if (!items?.length) return;
    const list = Array.from(items);
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };

  const measuring = rect === undefined;
  const spotStyle = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : { top: '50%', left: '50%', width: 0, height: 0 };

  return (
    <>
      <div className="aura-tour__blocker" onClick={goNext}/>
      <div className={`aura-tour__spot ${rect ? 'is-on' : ''}`} style={spotStyle} aria-hidden="true"/>
      <div ref={cardRef} role="dialog" aria-modal="true" tabIndex={-1}
        aria-labelledby="aura-tour-title" aria-describedby="aura-tour-body"
        className={`aura-tour__card ${measuring ? 'is-measuring' : ''}`}
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : undefined}
        onKeyDown={trapTab}
        onClick={(e) => e.stopPropagation()}>
        <div id="aura-tour-title" className="aura-tour__title">{step.title}</div>
        <p id="aura-tour-body" className="aura-tour__body">{step.body}</p>
        <div className="aura-tour__foot">
          <div className="aura-tour__dots" aria-hidden="true">
            {steps.map((s, i) => <span key={s.id} className={i === idx ? 'is-on' : ''}/>)}
          </div>
          <div className="aura-tour__btns">
            {idx > 0 && (
              <button type="button" className="aura-tour__btn" onClick={goBack}>back</button>
            )}
            <button type="button" className="aura-tour__btn aura-tour__btn--primary" onClick={goNext}>
              {idx >= steps.length - 1 ? 'done' : 'next'}
            </button>
          </div>
        </div>
        <button type="button" className="aura-tour__skip" onClick={finish}>skip tour</button>
      </div>
    </>
  );
}

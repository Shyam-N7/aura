import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SEED_ARTIST_FALLBACK } from '../data/seedArtists';
import { PRIMARY_LANGUAGES, MORE_LANGUAGES } from '../data/languages';
import { setSeedArtists, setSeedSignals, markOnboarded } from '../lib/onboarding';
import { AlbumArt } from '../components/album/AlbumArt';
import { AuraMark } from '../components/primitives';
import { OnboardingBackdrop } from './OnboardingBackdrop';
import { GooFilter } from '../components/GooFilter';
import { getDiscoverHome } from '../api/discover';
import { getArtist } from '../api/artists';
import './OnboardingScreen.css';

const MIN_PICKS = 3;   // minimum artists to finish; no upper cap
const MAX_TILES = 12;

// Selection-goo timing, in sequence: the drop FLIES from the last pill to the
// target (TRAVEL — the visible trajectory), THEN the goo BLOOMs up to fill the
// target, THEN the crisp pill SETTLEs in as the overlay fades out (a seamless
// same-colour crossfade). These mirror the phase-scoped CSS durations on the
// drop/blob. Total window = TRAVEL + BLOOM + SETTLE.
const MELT_TRAVEL = 460;
const MELT_BLOOM = 300;
const MELT_SETTLE = 180;

// Session cache of real artist photos keyed by artist name. The grid is built
// from trending TRACKS (which only carry song/album covers), so we lazily
// upgrade each tile to the artist's actual image. undefined = in flight,
// null = none/failed (keep the song cover).
const artistImgCache = new Map();

// The three steps, in order. Language goes first because it filters the artist
// grid; mood sits in the middle; artists last (the heaviest choice). All three
// are required to finish — Next is gated per-step, the final step submits.
const STEPS = [
  { key: 'language', label: 'Language', title: 'What languages do you listen to?' },
  { key: 'mood',     label: 'Mood',     title: 'How do you feel?' },
  { key: 'artists',  label: 'Artists',  title: 'Pick three or more artists you love.' },
];

// Six moods with the visual metadata each card carries: a 135° linear-gradient
// swatch (left of the card), a small line-art icon centered inside the swatch
// that says what the mood *feels* like (focal dot for focused, crescent for
// late-night, etc.), and a two-word subtitle that says what the label means.
// Palette is muted-warm and saturation-shifted toward AURA's dusk temperature
// axis — no Tailwind-primary blues / greens / purples that would jump out of
// the warm-cream + ink-brown family the rest of the UI lives in.
// `tint` / `tintSoft` (reused from each swatch's hue) drive the ambient backdrop
// (OnboardingBackdrop) so the whole screen warms to the picked mood.
const MOODS = [
  { key: 'focused',     label: 'Focus',      sub: 'For concentration',  swatch: 'linear-gradient(135deg, #6e85a3, #475c7a)', tint: '#6e85a3', tintSoft: 'rgba(110,133,163,0.16)', icon: <FocusedIcon/>     },
  { key: 'unwound',     label: 'Chill',      sub: 'Wind down',          swatch: 'linear-gradient(135deg, #c4a36e, #976e3f)', tint: '#c4a36e', tintSoft: 'rgba(196,163,110,0.16)', icon: <UnwoundIcon/>     },
  { key: 'in-motion',   label: 'Energy',     sub: 'Get pumped',         swatch: 'linear-gradient(135deg, #c47554, #934530)', tint: '#c47554', tintSoft: 'rgba(196,117,84,0.16)',  icon: <InMotionIcon/>    },
  { key: 'late-night',  label: 'Late Night', sub: 'After-hours vibes',  swatch: 'linear-gradient(135deg, #466855, #2a3f33)', tint: '#4f7a62', tintSoft: 'rgba(79,122,98,0.20)',   icon: <LateNightIcon/>   },
  { key: 'curious',     label: 'Discover',   sub: 'Try new music',      swatch: 'linear-gradient(135deg, #8970a0, #5c4878)', tint: '#8970a0', tintSoft: 'rgba(137,112,160,0.16)', icon: <CuriousIcon/>     },
  { key: 'remembering', label: 'Throwback',  sub: 'Old favorites',      swatch: 'linear-gradient(135deg, #b08e6a, #7e5e3e)', tint: '#b08e6a', tintSoft: 'rgba(176,142,106,0.16)', icon: <RememberingIcon/> },
];

// Mood glyphs — small (22 px) line-art symbols rendered in the centre of each
// swatch at low opacity so the gradient still reads first. Stroke / fill is
// `currentColor` so we can tint via CSS (white-ish on the swatch).
// Each animated element gets a class hook so the .css can target it for
// keyframes (transform-box: fill-box is needed for SVG children to scale
// around their own centre instead of the SVG origin).
function FocusedIcon() {  // focal dot pulses gently inside two stable rings — stillness, centre
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" className="aura-onb__glyph-focused">
      <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1" opacity="0.55"/>
      <circle cx="11" cy="11" r="4.5" stroke="currentColor" strokeWidth="1" opacity="0.7"/>
      <circle cx="11" cy="11" r="1.6" fill="currentColor" className="aura-onb__fx-pulse"/>
    </svg>
  );
}
function UnwoundIcon() {  // arc breathes vertically; dot bobs — soft, opened
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" className="aura-onb__glyph-unwound">
      <path d="M3 13 Q11 5 19 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="aura-onb__fx-arc"/>
      <circle cx="11" cy="9.5" r="1.2" fill="currentColor" opacity="0.7" className="aura-onb__fx-bob"/>
    </svg>
  );
}
function InMotionIcon() {  // trail lines fade in sequence behind a forward chevron
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" className="aura-onb__glyph-in-motion">
      <path d="M3 11 H17 M12 6 L17 11 L12 16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 7.5 H8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" className="aura-onb__fx-trail aura-onb__fx-trail--a"/>
      <path d="M2 14.5 H8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" className="aura-onb__fx-trail aura-onb__fx-trail--b"/>
    </svg>
  );
}
function LateNightIcon() {  // small companion star twinkles next to the crescent
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" className="aura-onb__glyph-late-night">
      <path d="M16 11 a6 6 0 1 1 -6 -6 a5 5 0 0 0 6 6 z" fill="currentColor" opacity="0.9"/>
      <circle cx="17" cy="6" r="0.7" fill="currentColor" opacity="0.6" className="aura-onb__fx-twinkle"/>
    </svg>
  );
}
function CuriousIcon() {  // four-point spark slowly rotates + breathes — flash of discovery
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" className="aura-onb__glyph-curious">
      <path d="M11 2 L12 9 L19 11 L12 13 L11 20 L10 13 L3 11 L10 9 Z" fill="currentColor" className="aura-onb__fx-spark"/>
    </svg>
  );
}
function RememberingIcon() {  // spiral rotates slowly anti-clockwise — looking back
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" className="aura-onb__glyph-remembering">
      <g className="aura-onb__fx-spin">
        <path d="M5 14 a6 6 0 1 1 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
        <path d="M5 14 L3.5 11 M5 14 L8 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </g>
    </svg>
  );
}

// First-run "pick three" flow — a step-by-step stepper with three required
// signals (language → mood → artists), one panel at a time. Language pills
// filter the artist grid; the stepper dots in the head track progress and let
// the user jump back to a completed step. Next is gated until the current step
// is satisfied; the final step submits.
export function OnboardingScreen({ pool = [], onDone }) {
  const [selectedLangs, setSelectedLangs] = useState(() => new Set());
  const [selectedMood,  setSelectedMood]  = useState(null);
  // `picks` is an ordered array (insertion order carries into the seed payload).
  const [picks,         setPicks]         = useState(() => []);
  // How many artist tiles are revealed. Starts at one page; "load more" grows it
  // so a user who doesn't like the first dozen can pull in the rest of the pool.
  const [visibleCount,  setVisibleCount]  = useState(MAX_TILES);
  // Set once the user taps "load more" — gates the custom loader so it lights only
  // after a tap (not on the initial grid), while the new photos are fetching.
  const [loadMoreClicked, setLoadMoreClicked] = useState(false);
  // Trending tracks pulled on mount. Used as the primary artist source — the
  // `pool` prop is a fallback while trending loads (and if it fails).
  const [trending, setTrending] = useState([]);
  const [artistImages, setArtistImages] = useState(() => new Map());
  // Which step is on screen (0 language · 1 mood · 2 artists), and the last
  // navigation direction so the panel slides in from the correct side.
  const [step, setStep] = useState(0);
  const [dir,  setDir]  = useState(1);   // 1 = forward, -1 = back
  const [showMoreLangs, setShowMoreLangs] = useState(false);
  const [langsClosing,  setLangsClosing]  = useState(false);
  const langsCloseTimer = useRef(0);
  // Goo selection: a drop flows off the previously-picked chip and merges into
  // the newly-picked one. We measure both chips, then run the drop + a growing
  // target blob inside a #aura-goo-strong overlay so they melt together; only
  // those two shapes are filtered, so no other pills are touched.
  const chiprowRef = useRef(null);
  const lastPickedLang = useRef(null);
  const [melt, setMelt] = useState(null);              // { id, source, target } | null
  const [meltGeom, setMeltGeom] = useState(null);      // measured coords, set pre-paint
  const [meltPhase, setMeltPhase] = useState('enter'); // enter → run → settle
  const meltSeq = useRef(0);
  // "more languages" toggle glides to its new spot when the row expands/collapses
  // (FLIP: remember its last box, jump it back by the delta, transition to 0).
  const moreLangsRef = useRef(null);
  const moreLangsRect = useRef(null);

  useEffect(() => {
    const ctl = new AbortController();
    getDiscoverHome({ signal: ctl.signal })
      .then(data => setTrending(Array.isArray(data?.trending) ? data.trending : []))
      .catch(() => { /* fall through to pool */ });
    return () => ctl.abort();
  }, []);

  // Both trending and the featured pool are popularity signals — combine them so
  // the picker has a deep bench of recognizable artists (buildTiles dedups +
  // frequency-ranks them). Trending leads (it's "popular now").
  const source = useMemo(
    () => (trending.length ? [...trending, ...pool] : pool),
    [trending, pool],
  );
  const allTiles = useMemo(() => buildTiles(source), [source]);
  const tiles = useMemo(() => {
    if (selectedLangs.size === 0) return allTiles;
    // Float the picked languages to the front rather than hiding the rest — the
    // grid stays broad (never "no artists in those languages"), just relevant.
    const preferred = (t) => (t.language && selectedLangs.has(String(t.language).toLowerCase()) ? 0 : 1);
    return [...allTiles].sort((a, b) => preferred(a) - preferred(b));
  }, [allTiles, selectedLangs]);
  const visibleTiles = tiles.slice(0, visibleCount);
  const canLoadMore  = tiles.length > visibleCount;
  // Any revealed tile still fetching its real artist photo — drives the per-tile
  // shimmer. After a "load more" tap it also lights the button's custom loader.
  const imagesPending = step === 2 && visibleTiles.some(t => !artistImages.has(t.name));
  const loadingMore = loadMoreClicked && imagesPending;

  // Once on the artist step, swap each visible tile's song cover for the real
  // artist photo (getArtist by trackId is deterministic; seed artists with no
  // track fall back to a name lookup). Cached per name, fetched once.
  useEffect(() => {
    if (step !== 2) return undefined;
    const pending = visibleTiles.filter(t => t.name && !artistImgCache.has(t.name));
    if (!pending.length) return undefined;
    let cancelled = false;
    pending.forEach(t => artistImgCache.set(t.name, undefined));   // mark in-flight
    Promise.allSettled(pending.map(t =>
      getArtist(t.sampleTrackId ? { trackId: t.sampleTrackId } : { name: t.name })
        .then(a => { artistImgCache.set(t.name, a?.image || null); })
        .catch(() => { artistImgCache.set(t.name, null); }),
    )).then(() => { if (!cancelled) setArtistImages(new Map(artistImgCache)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tiles, visibleCount]);

  // Toggle a language. Adding one past the first flows a goo drop off the
  // previously-picked chip into the new one (driven by the melt layout effect);
  // the first pick and any removal just settle without a drop.
  const toggleLang = (L) => {
    const adding = !selectedLangs.has(L);
    setSelectedLangs(prev => {
      const next = new Set(prev);
      if (next.has(L)) next.delete(L); else next.add(L);
      return next;
    });
    if (adding) {
      const source = lastPickedLang.current;
      lastPickedLang.current = L;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (source && source !== L && !reduce) {
        setMelt({ id: ++meltSeq.current, source, target: L });
      }
    } else if (lastPickedLang.current === L) {
      // The most-recent pick was removed — repoint to the next-most-recent still
      // selected (or none), so the next add flows from a chip that exists.
      const remaining = [...selectedLangs].filter(x => x !== L);
      lastPickedLang.current = remaining.length ? remaining[remaining.length - 1] : null;
    }
  };

  const toggleMood = (key) => setSelectedMood(prev => prev === key ? null : key);

  // No upper cap — tap to add or remove any number of artists (a minimum of
  // MIN_PICKS is required to finish).
  const togglePick = (name) => setPicks(prev =>
    prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name],
  );

  // Language chips: the primary set is always shown; the rest sit behind a
  // "more languages" toggle. Stay expanded if the user already picked an extra
  // (so a hidden-but-selected chip can't go missing).
  const moreLangSelected = MORE_LANGUAGES.some(l => selectedLangs.has(l));
  const langsExpanded = showMoreLangs || moreLangSelected;
  // Drive a pick's goo melt: measure the source + target chip (positions relative
  // to the row, so wrapping is handled), then sequence the phases so the
  // trajectory is the story — enter → run (the drop flies the visible path) →
  // bloom (goo rises to fill the target) → settle (crisp pill fades in as the
  // overlay fades out). `angle` lets the drop stretch along its path mid-flight.
  useLayoutEffect(() => {
    if (!melt) return undefined;
    const row = chiprowRef.current;
    const src = row?.querySelector(`[data-lang="${melt.source}"]`);
    const tgt = row?.querySelector(`[data-lang="${melt.target}"]`);
    if (!row || !src || !tgt) { setMelt(null); return undefined; }
    const r = row.getBoundingClientRect();
    const s = src.getBoundingClientRect();
    const t = tgt.getBoundingClientRect();
    const sx = s.left - r.left + s.width / 2, sy = s.top - r.top + s.height / 2;
    const tx = t.left - r.left + t.width / 2, ty = t.top - r.top + t.height / 2;
    setMeltGeom({
      sx, sy, tx, ty,
      sl: s.left - r.left, st: s.top - r.top, sw: s.width, sh: s.height,
      tl: t.left - r.left, tt: t.top - r.top, tw: t.width, th: t.height,
      angle: Math.atan2(ty - sy, tx - sx) * 180 / Math.PI,
    });
    setMeltPhase('enter');
    const raf = requestAnimationFrame(() => setMeltPhase('run'));
    const t1 = setTimeout(() => setMeltPhase('bloom'), MELT_TRAVEL);
    const t2 = setTimeout(() => setMeltPhase('settle'), MELT_TRAVEL + MELT_BLOOM);
    const t3 = setTimeout(() => { setMelt(null); setMeltGeom(null); setMeltPhase('enter'); }, MELT_TRAVEL + MELT_BLOOM + MELT_SETTLE);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [melt]);

  // FLIP the "more languages" toggle so it glides to its new position when the
  // row expands/collapses (instead of snapping). Remember its last box; on the
  // next layout, jump it back by the delta then transition to its natural spot.
  useLayoutEffect(() => {
    const btn = moreLangsRef.current;
    if (!btn) { moreLangsRect.current = null; return undefined; }
    const next = btn.getBoundingClientRect();
    const prev = moreLangsRect.current;
    moreLangsRect.current = next;
    if (!prev) return undefined;
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (!dx && !dy) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    btn.style.transition = 'none';
    btn.style.transform = `translate(${dx}px, ${dy}px)`;
    btn.getBoundingClientRect();   // force reflow so the start offset sticks
    btn.style.transition = '';     // back to the CSS transform transition…
    btn.style.transform = '';      // …which animates the button to its spot
    return undefined;
  }, [langsExpanded, langsClosing]);
  useEffect(() => () => clearTimeout(langsCloseTimer.current), []);
  // Toggle the extra languages inline. Opening buds them in; closing keeps them
  // mounted briefly so they can drip back out before unmounting.
  const toggleMoreLangs = () => {
    const next = !showMoreLangs;
    setShowMoreLangs(next);
    if (next) {
      setLangsClosing(false);
    } else {
      setLangsClosing(true);
      clearTimeout(langsCloseTimer.current);
      langsCloseTimer.current = setTimeout(() => setLangsClosing(false), 420);
    }
  };

  // Per-step completeness — all three are required before the flow can finish.
  const valid = [
    selectedLangs.size > 0,
    !!selectedMood,
    picks.length >= MIN_PICKS,
  ];
  const isLast = step === STEPS.length - 1;
  const selectedMoodMeta = MOODS.find(m => m.key === selectedMood);
  // Chip appearance through the melt. Target: stays UNSELECTED while the drop is in
  // flight (`travelTarget`) so the trajectory is the whole story; once the drop
  // lands it just flips selected and its OWN pill fill fades in smoothly (the chip's
  // 160ms background transition) — no popping goo blob. Source: ghosted during
  // enter/run (`sourceGhost`) — transparent so its overlay fill-blob reads as the
  // fill and the drop can pull a tail off it, label crisp on top.
  const inFlight = melt && (meltPhase === 'enter' || meltPhase === 'run');
  const travelTarget = inFlight ? melt.target : null;
  const sourceGhost = inFlight ? melt.source : null;

  // A step is reachable by tapping its dot only when every step before it is
  // satisfied — so you can always go back, and only jump forward over completed
  // steps (never skip an unfinished one).
  const canGoTo = (i) => valid.slice(0, i).every(Boolean);
  const goTo = (i) => {
    if (i === step || !(i < step || canGoTo(i))) return;
    setDir(i > step ? 1 : -1);
    setStep(i);
  };
  const goNext = () => {
    if (!valid[step]) return;
    if (isLast) { submit(); return; }
    setDir(1);
    setStep(s => s + 1);
  };
  const goBack = () => {
    if (step === 0) return;
    setDir(-1);
    setStep(s => s - 1);
  };

  const submit = () => {
    const pickMeta = picks
      .map(name => allTiles.find(t => t.name === name))
      .filter(Boolean)
      .map(t => ({ name: t.name, language: t.language, sampleTrackId: t.sampleTrackId }));
    setSeedArtists(pickMeta);
    setSeedSignals({ languages: [...selectedLangs], mood: selectedMood });
    markOnboarded();
    onDone?.(pickMeta);
  };

  // Top strip reflects position in the flow (step N of 3), advancing on Next.
  const progressPct = ((step + 1) / STEPS.length) * 100;

  // Tint the ambient backdrop to the chosen mood — before any pick, the theme
  // accent keeps step 1 already glowing warm. OnboardingBackdrop's blooms / orb /
  // sketches read these vars; they crossfade via @property (see the CSS).
  const tintStyle = {
    '--onb-tint':      selectedMoodMeta?.tint     ?? 'var(--color-accent)',
    '--onb-tint-soft': selectedMoodMeta?.tintSoft ?? 'var(--color-accent-soft)',
  };

  return (
    <div className="aura-onb" style={tintStyle}>
      <OnboardingBackdrop/>
      <GooFilter/>
      {/* top viewport progress strip — accent fill tracks the current step */}
      <div className="aura-onb__top-strip">
        <div className="aura-onb__top-strip-fill" style={{ width: `${progressPct}%` }}/>
      </div>

      <div className="aura-onb__card">
        {/* ─── Head: brand + stepper + the active step's question ────────── */}
        <div className="aura-onb__card-head">
          <div className="aura-onb__brand">
            <span className="aura-onb__brand-icon"><AuraMark size={20}/></span>
            <span className="aura-onb__brand-text">aura welcomes you!</span>
            <span className="aura-onb__brand-welcome">aura welcomes you!</span>
          </div>

          <ol className="aura-onb__stepper" aria-label="Setup progress">
            {STEPS.map((s, i) => (
              <StepperNode key={s.key} n={i + 1} label={s.label}
                status={i === step ? 'active' : valid[i] ? 'done' : 'pending'}
                clickable={i < step || canGoTo(i)}
                onClick={() => goTo(i)}/>
            ))}
          </ol>

          <header className="aura-onb__step-header">
            <span className="aura-onb__step-num">{String(step + 1).padStart(2, '0')}</span>
            <h2 className="aura-onb__step-title">{STEPS[step].title}</h2>
            {step === 0 && selectedLangs.size > 0 && (
              <span className="aura-onb__step-meta">{selectedLangs.size} selected</span>
            )}
            {step === 1 && selectedMoodMeta && (
              <span className="aura-onb__step-meta aura-onb__step-meta--quote">
                &ldquo;{selectedMoodMeta.label}&rdquo;
              </span>
            )}
            {step === 2 && (
              <span className="aura-onb__step-meta">
                {picks.length < MIN_PICKS ? `${picks.length} of ${MIN_PICKS}` : `${picks.length} selected`}
              </span>
            )}
          </header>
        </div>

        {/* ─── Panel: the active step, keyed so it slides in on change ───── */}
        <div key={step} className={`aura-onb__panel aura-onb__panel--${dir > 0 ? 'fwd' : 'back'}`}>
          {/* 01 — Languages: one flowing row. Picking a language flows a goo drop
              off the last-picked chip into the new one (the overlay below holds
              only that drop + the target's fill blob, so nothing else merges).
              "more languages" reveals the extras inline with a clean fade. */}
          {step === 0 && (
            <div className="aura-onb__chiprow" ref={chiprowRef}>
              {/* Selection goo — the source pill's fill blob + the flying drop, both
                  under #aura-goo-strong so the drop pulls a liquid TAIL off the source
                  pill. The target is NOT filled by goo — once the drop lands the chip
                  fills with its own crisp pill background (fades in, no pop). z above
                  the other crisp pills so the drop is visible mid-flight; the ghosted
                  source chip sits above and shows its blob as fill. */}
              {melt && meltGeom && (
                <div className={`aura-onb__chip-goo is-${meltPhase}`} aria-hidden="true">
                  {/* source fill blob — the previously-picked pill, present while the
                      drop sits on it + flies off, so the metaball bridges the two into
                      a tail that snaps as the drop clears the blur radius. */}
                  {(meltPhase === 'enter' || meltPhase === 'run') && (
                    <span className="aura-onb__goo-blob aura-onb__goo-blob--source" style={{
                      left: meltGeom.sl, top: meltGeom.st, width: meltGeom.sw, height: meltGeom.sh,
                    }}/>
                  )}
                  {/* the drop: solid ink, sits on the source pill, flies to the target,
                      gently stretched along its path, rounding back as it lands. */}
                  <span className="aura-onb__drop" style={{
                    transform:
                      `translate(${meltPhase === 'enter' ? meltGeom.sx : meltGeom.tx}px, ${meltPhase === 'enter' ? meltGeom.sy : meltGeom.ty}px) `
                      + `translate(-50%, -50%) rotate(${meltGeom.angle}deg) `
                      + (meltPhase === 'enter' ? 'scale(.6)' : meltPhase === 'run' ? 'scale(1.3, .82)' : 'scale(1)'),
                  }}/>
                </div>
              )}
              {PRIMARY_LANGUAGES.map(L => (
                <LangChip key={L} lang={L} on={selectedLangs.has(L) && travelTarget !== L} onClick={() => toggleLang(L)}
                  melting={sourceGhost === L}/>
              ))}
              {(langsExpanded || langsClosing) && MORE_LANGUAGES.map((L, i) => (
                <LangChip key={L} lang={L} on={selectedLangs.has(L) && travelTarget !== L} onClick={() => toggleLang(L)}
                  extra gi={i} closing={langsClosing} melting={sourceGhost === L}/>
              ))}
              {!moreLangSelected && (
                <button type="button" ref={moreLangsRef} className="aura-onb__more-langs" onClick={toggleMoreLangs}>
                  {showMoreLangs ? 'fewer' : 'more languages'}
                  <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                    <path d={showMoreLangs ? 'M3 8 L6.5 4.5 L10 8' : 'M3 5 L6.5 8.5 L10 5'}
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* 02 — Moods */}
          {step === 1 && (
            <div className="aura-onb__moods">
              {MOODS.map(m => {
                const on = selectedMood === m.key;
                return (
                  <button key={m.key} type="button" onClick={() => toggleMood(m.key)}
                    className={`aura-onb__mood ${on ? 'aura-onb__mood--on' : ''}`}>
                    <span className="aura-onb__mood-swatch" style={{ background: m.swatch }} aria-hidden="true">
                      <span className="aura-onb__mood-glyph">{m.icon}</span>
                    </span>
                    <span className="aura-onb__mood-body">
                      <span className="aura-onb__mood-label">{m.label}</span>
                      <span className="aura-onb__mood-sub">{m.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 03 — Artists: a square-tile grid (real artist photos), one beside
              the other. Multi-select, min 3, no cap. */}
          {step === 2 && (
            <>
              <div className="aura-onb__grid">
                {visibleTiles.map((t, i) => {
                  const on = picks.includes(t.name);
                  return (
                    <button key={t.name} type="button" onClick={() => togglePick(t.name)}
                      style={{ '--i': i }}
                      className={`aura-onb__tile ${on ? 'aura-onb__tile--on' : ''}`}>
                      <div className="aura-onb__tile-art">
                        <AlbumArt
                          track={{ id: t.sampleTrackId, imageUrl: artistImages.get(t.name) || t.imageUrl, artist: t.name, cover: coverFor(i) }}
                          radius={10}
                          style={{ width: '100%', height: '100%', aspectRatio: 1 }}/>
                        {!artistImages.has(t.name) && <div className="aura-onb__tile-skeleton" aria-hidden="true"/>}
                        {on && (
                          <span className="aura-onb__tile-check" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6 L5 8.5 L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </span>
                        )}
                        <div className="aura-onb__tile-scrim"/>
                        <div className="aura-onb__tile-name">{t.name}</div>
                      </div>
                    </button>
                  );
                })}
                {tiles.length === 0 && (
                  <div className="aura-onb__empty">No artists to show yet.</div>
                )}
              </div>
              {canLoadMore && (
                <button type="button" className={`aura-onb__loadmore ${loadingMore ? 'is-loading' : ''}`}
                  onClick={() => { setVisibleCount(c => c + 8); setLoadMoreClicked(true); }}
                  disabled={loadingMore}>
                  {loadingMore ? (
                    <>
                      <span className="aura-onb__loadmore-dots" aria-hidden="true"><i/><i/><i/></span>
                      Loading more
                    </>
                  ) : (
                    <>
                      Load more artists
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                        <path d="M6.5 2.5 V10.5 M2.5 6.5 H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>

        {/* ─── Foot: Back · Next / Get Started ───────────────────────────── */}
        <div className="aura-onb__foot">
          <button type="button" onClick={goBack} disabled={step === 0} className="aura-onb__back">
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
              <path d="M13 5 H2 M6 1 L2 5 L6 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
          <span className="aura-onb__foot-spacer"/>
          <button type="button" onClick={goNext} disabled={!valid[step]} className="aura-onb__next">
            {isLast ? 'Get Started' : 'Next'}
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
              <path d="M1 5 H12 M8 1 L12 5 L8 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function StepperNode({ n, label, status, clickable, onClick }) {
  return (
    <li className={`aura-onb__step-node aura-onb__step-node--${status}`}>
      <button type="button" className="aura-onb__step-btn" onClick={onClick} disabled={!clickable}
        aria-current={status === 'active' ? 'step' : undefined}>
        <span className="aura-onb__step-dot">
          {status === 'done' ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path d="M2 5.6 L4.4 8 L9 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : n}
        </span>
        <span className="aura-onb__step-label">{label}</span>
      </button>
    </li>
  );
}

// A language pill. `extra` chips (the ones behind "more languages") carry the
// `--gi` stagger index + the reveal/closing classes for the inline fade.
// `melting` is set on the chip currently being selected: its solid fill drops out
// so the goo blob behind reads as the fill while the drop lands. `data-lang` lets
// the melt effect find this chip's position to animate from/to.
function LangChip({ lang, on, onClick, extra = false, gi = 0, closing = false, melting = false }) {
  return (
    <button type="button" onClick={onClick} data-lang={lang}
      style={extra ? { '--gi': gi } : undefined}
      className={`aura-onb__chip ${on ? 'aura-onb__chip--on' : ''} ${extra ? 'aura-onb__chip--extra' : ''} ${extra && closing ? 'is-closing' : ''} ${melting ? 'is-melting' : ''}`}>
      <span className="aura-onb__chip-dot">
        {on && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 5 L4 7 L8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
      {lang.charAt(0).toUpperCase() + lang.slice(1)}
    </button>
  );
}

// Rotate procedural cover patterns for the fallback artist tiles — keeps the
// grid visually varied instead of monogram squares.
const COVER_ROTATION = ['rings', 'bands', 'circle', 'split'];
function coverFor(i) { return COVER_ROTATION[i % COVER_ROTATION.length]; }

function buildTiles(pool) {
  // Tally each artist's appearances — recurrence across the pool (plus its
  // trending order) is our popularity proxy, since the catalog has no dedicated
  // top-artists feed. An artist featured in many tracks is a bigger name.
  const seen = new Map();
  let order = 0;
  for (const t of pool) {
    const name = t.artist?.trim();
    if (!name) continue;
    const existing = seen.get(name);
    if (!existing) {
      seen.set(name, { name, language: t.language ?? null, imageUrl: t.imageUrl ?? null, sampleTrackId: t.id, count: 1, order: order++ });
    } else {
      existing.count += 1;
      if (!existing.imageUrl && t.imageUrl) existing.imageUrl = t.imageUrl;
    }
  }
  // Most-featured (popular) artists first; ties keep the trending order. The
  // full deduped list is returned (not capped at MAX_TILES) — the screen reveals
  // a page at a time via `visibleCount`. Curated big-name seeds backfill anything
  // the live pool didn't surface (and carry the grid when trending is empty).
  const fromPool = Array.from(seen.values())
    .sort((a, b) => b.count - a.count || a.order - b.order);
  const have = new Set(fromPool.map(t => t.name));
  const fill = SEED_ARTIST_FALLBACK.filter(t => !have.has(t.name));
  return [...fromPool, ...fill];
}

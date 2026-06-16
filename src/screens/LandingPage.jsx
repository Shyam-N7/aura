import { useCallback, useRef, useState, Fragment } from 'react';
import { AuraMark } from '../components/primitives/AuraMark';
import { BreathingDot } from '../components/primitives/BreathingDot';
import { toast } from '../lib/toast';
import { FeatureBand } from './landing/FeatureBand';
import { MoodBridgesSpotlight } from './landing/spotlights/MoodBridgesSpotlight';
import { LyricsSpotlight } from './landing/spotlights/LyricsSpotlight';
import { ThemesSpotlight } from './landing/spotlights/ThemesSpotlight';
import { SensingSpotlight } from './landing/spotlights/SensingSpotlight';
import { OrbitSpotlight } from './landing/spotlights/OrbitSpotlight';
import { EqualizerSpotlight } from './landing/spotlights/EqualizerSpotlight';
import { TalkAuraSpotlight } from './landing/spotlights/TalkAuraSpotlight';
import { PlayerSpotlight } from './landing/spotlights/PlayerSpotlight';
import { useGsap, landingScrollTo } from './landing/useGsap';
import { CursorFollower } from './landing/CursorFollower';
import { HeroOrb, hasWebGL } from './landing/HeroOrb';
import { useHeroOrbAudio } from './landing/useHeroOrbAudio';
import './LandingPage.css';

/* ── runLandingAnimations ──────────────────────────────────────────────────
   Continuous, depth-driven scroll. The page flows normally (Lenis in useGsap
   eases the scroll for inertia); GSAP ties motion CONTINUOUSLY to scroll position
   (scrub) instead of one-shot pops: a springy hero entrance on load, two-layer
   hero parallax for depth, and a scroll-linked rise+fade reveal per section that
   reverses cleanly. The DNA build + count-up stay; per-spotlight flourishes live
   in their own components. Runs only under (prefers-reduced-motion: no-preference)
   — reduced motion gets a plain, fully-visible native scroll. */
const POP = 'back.out(1.7)';      // springy hero entrance
const POP_BIG = 'back.out(2.2)';  // hero CTAs / DNA vertices
const CLEAR = 'transform';        // free CSS :hover after a pop settles

function runLandingAnimations({ gsap, q, ScrollTrigger }) {
  // 1 ─ Hero springs in on load.
  gsap.timeline({ defaults: { ease: POP, duration: 0.7, clearProps: CLEAR } })
    .from(q('.hero .eyebrow'), { opacity: 0, y: 18, scale: 0.9 })
    .from(q('.hero h1 .brand-line'), { opacity: 0, y: 20, scale: 0.9 }, '-=0.45')
    .from(q('.hero h1 .hero-h1-line'), { opacity: 0, y: 42, scale: 0.85, duration: 0.85 }, '-=0.45')
    .from(q('.hero h1 em'), { opacity: 0, y: 42, scale: 0.85, duration: 0.85 }, '-=0.6')
    .from(q('.hero .lead'), { opacity: 0, y: 18 }, '-=0.55')
    .from(q('.hero .ctas .btn'), { opacity: 0, y: 16, scale: 0.8, stagger: 0.1, ease: POP_BIG }, '-=0.45')
    .from(q('.hero .quote'), { opacity: 0, x: -24, ease: 'power3.out' }, '-=0.3')
    // hero-visual: clear ONLY opacity (the parallax below owns its transform).
    .from(q('.hero-visual'), { opacity: 0, scale: 0.85, duration: 1, ease: 'back.out(1.4)', clearProps: 'opacity' }, 0.1)
    .from(q('.hero-visual .album, .hero-visual .moodlet'),
      { opacity: 0, stagger: 0.08, duration: 0.6, ease: 'power2.out', clearProps: 'opacity' }, 0.5);

  // 2 ─ Hero parallax depth: the visual drifts up faster than the text as you
  //     leave the hero → a continuous two-layer depth (scrub = 1:1 with scroll).
  const heroPar = { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true };
  if (q('.hero-visual')[0]) gsap.to(q('.hero-visual'), { yPercent: -22, ease: 'none', scrollTrigger: { ...heroPar } });
  if (q('.hero > div:first-child')[0]) gsap.to(q('.hero > div:first-child'), { yPercent: -8, ease: 'none', scrollTrigger: { ...heroPar } });

  // 2b ─ Magnetic CTAs: the primary buttons gently pull toward the pointer (the
  //      "gravity" touch). Fine pointers only; listeners die with the page DOM.
  if (window.matchMedia('(pointer: fine)').matches) {
    q('.hero .ctas .btn, .lp-top .auth-cta').forEach((btn) => {
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3' });
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.3);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.3);
      });
      btn.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
    });
  }

  // 3 ─ Continuous motion: every section both (a) fades in as it enters and
  //     (b) DRIFTS the whole time it's on screen (parallax), so the page is never
  //     "reveal then freeze" — there's always movement tied 1:1 to scroll. Bands
  //     get a second, opposing layer (text vs live stage) for real depth.
  q('.lp-stage').forEach((stage) => {
    if (stage.querySelector('.hero')) return;
    const inner = stage.querySelector('.lp-stage__inner');
    if (!inner) return;
    // fade in over the entry window (reverses on scroll-up)
    gsap.fromTo(inner, { opacity: 0 }, {
      opacity: 1, ease: 'none',
      scrollTrigger: { trigger: stage, start: 'top 92%', end: 'top 60%', scrub: true },
    });
    // continuous parallax drift across the full crossing (gentle; padding absorbs it)
    gsap.fromTo(inner, { yPercent: 6 }, {
      yPercent: -6, ease: 'none',
      scrollTrigger: { trigger: stage, start: 'top bottom', end: 'bottom top', scrub: true },
    });
    // bands: opposing drift between the text column and the live component → depth
    const text = stage.querySelector('.lp-band__text');
    const liveStage = stage.querySelector('.lp-band__stage');
    if (text && liveStage) {
      gsap.fromTo(text, { yPercent: 8 }, { yPercent: -8, ease: 'none',
        scrollTrigger: { trigger: stage, start: 'top bottom', end: 'bottom top', scrub: true } });
      gsap.fromTo(liveStage, { yPercent: -5 }, { yPercent: 5, ease: 'none',
        scrollTrigger: { trigger: stage, start: 'top bottom', end: 'bottom top', scrub: true } });
    }
  });

  // 4 ─ DNA radar builds itself: grid sweeps, profile draws, vertices pop, count up.
  const radar = q('.dna-radar')[0];
  if (radar) {
    const at = { trigger: radar, start: 'top 82%', once: true };
    // Opacity only — .dna-radar carries a static 3D CSS transform we must keep.
    gsap.from(radar, { opacity: 0, duration: 0.8, ease: 'power2.out', clearProps: 'opacity', scrollTrigger: { ...at } });
    // Grid hexagons + axes stroke-draw in a quick outward sweep.
    radar.querySelectorAll('polygon[fill="none"], line').forEach((el, i) => {
      if (typeof el.getTotalLength !== 'function') return;
      const len = el.getTotalLength();
      gsap.fromTo(el,
        { strokeDasharray: len, strokeDashoffset: len },
        { strokeDashoffset: 0, duration: 0.7, ease: 'power2.out', delay: i * 0.05,
          clearProps: 'strokeDasharray,strokeDashoffset', scrollTrigger: { ...at } });
    });
    // The profile polygon draws on, then its vertices pop.
    const poly = radar.querySelector('polygon[fill^="url"]');
    if (poly && typeof poly.getTotalLength === 'function') {
      const len = poly.getTotalLength();
      gsap.fromTo(poly,
        { strokeDasharray: len, strokeDashoffset: len, opacity: 0.4 },
        { strokeDashoffset: 0, opacity: 1, duration: 1.1, ease: 'power2.inOut', delay: 0.45,
          clearProps: 'strokeDasharray,strokeDashoffset', scrollTrigger: { ...at } });
    }
    const verts = radar.querySelectorAll('circle');
    if (verts.length) {
      gsap.from(verts, {
        attr: { r: 0 }, duration: 0.5, stagger: 0.06, ease: POP_BIG, delay: 1, scrollTrigger: { ...at },
      });
    }
  }
  // Count each [data-count] up from 0 → its target. The JSX MUST render the real
  // final value as the node's text (not "0"): under reduced motion this block
  // never runs, so that text is what the visitor sees.
  q('[data-count]').forEach((node) => {
    const target = parseFloat(node.dataset.count);
    if (Number.isNaN(target)) return;
    const decimals = (node.dataset.count.split('.')[1] || '').length;
    const prefix = node.dataset.prefix || '';
    const proxy = { v: 0 };
    gsap.to(proxy, {
      v: target, duration: 1.2, ease: 'power1.out',
      scrollTrigger: { trigger: node, start: 'top 90%', once: true },
      onUpdate: () => { node.textContent = prefix + proxy.v.toFixed(decimals); },
    });
  });

  // Re-measure once after all triggers (incl. the per-spotlight ones created in
  // child components) are set up, so positions line up under Lenis.
  ScrollTrigger.refresh();
}

/* Honour the OS "reduce motion" setting for the page's one SMIL animation —
   CSS `animation: none` (the reduced-motion block in LandingPage.css) can't
   stop SMIL <animate>, so that radius pulse must be gated here in JS. */
function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/* Shared arrow glyph used by every CTA button. */
function ArrowSvg() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10">
      <path
        d="M1 5 H13 M9 1 L13 5 L9 9"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   NAV — glass TopNav
   ══════════════════════════════════════════════════════════════════════ */
function TopNav({ onNavigateAuth, theme, onToggleTheme }) {
  const scrollTo = useCallback(
    (id) => (e) => {
      e.preventDefault();
      landingScrollTo(document.getElementById(id));
    },
    [],
  );
  // Where the next click in the light → dark → pink cycle lands.
  const nextThemeLabel = theme === 'midnight' ? 'pink' : theme === 'bloom' ? 'light' : 'dark';

  return (
    <nav className="lp-top">
      <div className="bar">
        <button className="brand" type="button" onClick={scrollTo('top')}>
          <AuraMark size={20} />
          <span className="brand-id">
            <span className="brand-name">aura</span>
            <span className="brand-tagline">AI radio that reads your mood</span>
          </span>
        </button>
        <div className="links">
          <a href="#how" onClick={scrollTo('how')}>How it works</a>
          <a href="#features" onClick={scrollTo('features')}>Features</a>
          <a href="#vision" onClick={scrollTo('vision')}>Vision</a>
          <a href="#pricing" onClick={scrollTo('pricing')}>Pricing</a>
        </div>
        <button className="auth-cta" type="button" onClick={() => onNavigateAuth('signin')}>
          Sign in &rarr;
        </button>
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${nextThemeLabel} theme`}
          title={`Switch to ${nextThemeLabel} theme`}
        >
          {/* All three icons are always rendered; CSS cross-fades + rotates to
              the one matching the active theme (light → dark → pink cycle) so the
              swap morphs instead of snapping. */}
          <span className="ttico ttico--sun" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="ttico ttico--moon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 9.5A6.5 6.5 0 016.5 2 5.5 5.5 0 1014 9.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {/* Blossom — outline only (sketch), fixed pink so it always reads as
              "the pink theme". */}
          <span className="ttico ttico--bloom" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                 stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round">
              <ellipse cx="8" cy="4.4" rx="1.3" ry="2.65" />
              <ellipse cx="8" cy="4.4" rx="1.3" ry="2.65" transform="rotate(72 8 8)" />
              <ellipse cx="8" cy="4.4" rx="1.3" ry="2.65" transform="rotate(144 8 8)" />
              <ellipse cx="8" cy="4.4" rx="1.3" ry="2.65" transform="rotate(216 8 8)" />
              <ellipse cx="8" cy="4.4" rx="1.3" ry="2.65" transform="rotate(288 8 8)" />
              <circle cx="8" cy="8" r="0.95" />
            </svg>
          </span>
        </button>
      </div>
    </nav>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   HERO 3D VISUAL — breathing orb, orbiting ring, three floating albums,
   four mood spheres.
   ══════════════════════════════════════════════════════════════════════ */
function Hero3DVisual({ enableOrb, isPlaying, analyser }) {
  // The CSS orb (.orb-bg/.orb-ring) is the always-present fallback; once the WebGL
  // orb is live (onReady), `.orb-active` hides it so they don't double up.
  const [orbReady, setOrbReady] = useState(false);
  return (
    <div className={`hero-visual${orbReady ? ' orb-active' : ''}`} aria-hidden="true">
      <div className="orb-bg" />
      <div className="orb-ring" />
      {enableOrb && <HeroOrb isPlaying={isPlaying} analyser={analyser} onReady={() => setOrbReady(true)} />}

      <div className="album-stack">
        {/* a1 — violet */}
        <div className="album a1">
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 32% 38%, #b8a4ff 0%, #3a2b6b 65%)' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: '60%', aspectRatio: '1', transform: 'translate(-50%,-50%)', borderRadius: '50%', border: '1px solid rgba(184,164,255,0.5)' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: '40%', aspectRatio: '1', transform: 'translate(-50%,-50%)', borderRadius: '50%', border: '1px solid rgba(184,164,255,0.8)' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: '10%', aspectRatio: '1', transform: 'translate(-50%,-50%)', borderRadius: '50%', background: '#b8a4ff', boxShadow: '0 0 30px #b8a4ff' }} />
          <div className="meta">Sunset Drive<span className="sub">Maya Reed &middot; 2023</span></div>
        </div>
        {/* a2 — amber (center) */}
        <div className="album a2">
          <div style={{ position: 'absolute', inset: 0, background: '#1a1410' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: '10%', height: '14%', background: '#6b4a2b' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: '24%', height: '6%', background: '#e8b87a' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: '38%', height: '14%', background: '#6b4a2b', opacity: 0.95 }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: '58%', height: '6%', background: '#e8b87a', opacity: 0.6 }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: '82%', height: '6%', background: '#6b4a2b', opacity: 0.5 }} />
          <div className="meta">Open Window<span className="sub">Leo Hart &middot; 2024</span></div>
        </div>
        {/* a3 — jade */}
        <div className="album a3">
          <div style={{ position: 'absolute', inset: 0, background: '#0e1a14' }} />
          <div style={{ position: 'absolute', left: '18%', top: '14%', width: '68%', aspectRatio: '1', borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, #a8d8b0, #2f5b42 70%)', boxShadow: 'inset 0 0 60px #0e1a14' }} />
          <div className="meta">Slow Morning<span className="sub">Nina Cole &middot; 2024</span></div>
        </div>
      </div>

      {/* floating mood spheres */}
      <div className="moodlet m1"><div className="label">energetic</div></div>
      <div className="moodlet m2"><div className="label">calm</div></div>
      <div className="moodlet m3"><div className="label">focused</div></div>
      <div className="moodlet m4"><div className="label">gentle</div></div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   HERO
   ══════════════════════════════════════════════════════════════════════ */
function Hero({ onNavigateAuth, audio }) {
  // The orb + its audio only run on a capable, motion-OK device; otherwise the
  // CSS orb stands in and there's no play control.
  const [enableOrb] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return hasWebGL();
  });
  return (
    <header className="hero">
      <div>
        <div className="eyebrow">
          <span className="mono">
            <BreathingDot color="var(--accent)" size={8} style={{ marginRight: 8 }} />
            Now in early access &middot; Spring 2026
          </span>
        </div>
        <h1>
          <span className="brand-line">AURA FM</span>
          <span className="hero-h1-line">music that</span><br />
          <em>gets your mood.</em>
        </h1>
        <p className="lead">
          AURA FM is an AI music player and personal radio that learns how you feel
          and plays songs that fit — without you picking a mood.
        </p>
        <div className="ctas">
          <button className="btn btn-primary" type="button" onClick={() => onNavigateAuth('signup')}>
            Try AURA
            <ArrowSvg />
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => onNavigateAuth('signup')}>
            Create account
          </button>
        </div>
        <div className="quote">
          <div className="avatar">m</div>
          <div>
            <p>
              &ldquo;It played a song I&apos;d forgotten about because my mom used
              to hum it. I cried in the kitchen. I don&apos;t think Spotify could
              ever.&rdquo;
            </p>
            <span className="mono">mira &middot; early user, lisbon</span>
          </div>
        </div>
      </div>

      <div className="hero-stage">
        <Hero3DVisual enableOrb={enableOrb} isPlaying={audio.isPlaying} analyser={audio.analyser} />
        {enableOrb && (
          <button
            className={`orb-play${audio.isPlaying ? ' is-playing' : ''}`}
            type="button"
            onClick={audio.toggle}
            aria-pressed={audio.isPlaying}
            aria-label={audio.isPlaying ? 'Pause the ambient sound' : 'Play the ambient sound'}
          >
            <span className="orb-play__icon" aria-hidden="true">
              {audio.isPlaying
                ? <svg width="11" height="13" viewBox="0 0 12 14"><rect x="0" width="4" height="14" fill="currentColor" /><rect x="8" width="4" height="14" fill="currentColor" /></svg>
                : <svg width="11" height="13" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor" /></svg>}
            </span>
            <span className="orb-play__label">{audio.isPlaying ? 'sound on' : 'feel it'}</span>
          </button>
        )}
      </div>
    </header>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   MARQUEE
   ══════════════════════════════════════════════════════════════════════ */
function Marquee() {
  const items = [
    ['gets your mood', 'no questions asked'],
    ['your own radio', 'tuned to your mood'],
    ['builds the flow', 'not just playlists'],
    ['talk to it', 'in plain words'],
    ['brings back songs', 'at the right moment'],
    ['built around feeling', 'not genre'],
  ];
  // duplicate for a seamless loop
  const doubled = [...items, ...items];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {doubled.map(([main, sub], i) => (
          <Fragment key={i}>
            <span>{main} <em className="mono">{sub}</em></span>
            {/* separators alternate: aura mark ⇄ pulsing dot, equal gap either side */}
            <span className="marquee-sep">
              {i % 2 === 0
                ? <span className="marquee-sep__mark animate-aura-soft"><AuraMark size={18}/></span>
                : <BreathingDot color="var(--accent)" size={7}/>}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PROBLEM — three cards
   ══════════════════════════════════════════════════════════════════════ */
function ProblemSection() {
  return (
    <section className="lp-body">
      <div className="section-head">
        <span className="mono">01 &middot; the problem</span>
        <h2>
          Music apps know your playlists.<br />
          <em>None of them know you.</em>
        </h2>
        <p className="kicker">
          Twenty years of &ldquo;Discover Weekly&rdquo;. Apps that mistake your
          listening history for actually knowing you. We think there&apos;s a
          better way.
        </p>
      </div>

      <div className="problem-grid">
        <div className="problem-card">
          <span className="num">01</span>
          <h3>They optimise for plays, not <em className="italic">feeling.</em></h3>
          <p>
            Most apps reward whatever keeps you streaming. AURA picks songs that
            match how you feel and flow well together.
          </p>
        </div>
        <div className="problem-card">
          <span className="num">02</span>
          <h3>They ask. We <em className="italic">read.</em></h3>
          <p>
            Being asked &ldquo;what&apos;s your mood?&rdquo; gets old. AURA figures
            it out from the time of day, what you&apos;re playing, and what you
            skip.
          </p>
        </div>
        <div className="problem-card">
          <span className="num">03</span>
          <h3>They give you a box. We give you a <em className="italic">conversation.</em></h3>
          <p>
            Tell AURA what you want — &ldquo;take me somewhere quieter&rdquo;,
            &ldquo;I need to focus&rdquo; — and it rebuilds the queue on the spot.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   HOW IT WORKS — 3D tilted card stack
   ══════════════════════════════════════════════════════════════════════ */
function HowItWorksSection() {
  const reduceMotion = prefersReducedMotion();
  return (
    <section className="lp-body how-section">
      <div className="how-inner">
        <div className="section-head">
          <span className="mono">02 &middot; how aura works</span>
          <h2>
            Three things AURA does,<br />
            <em>quietly in the background.</em>
          </h2>
          <p className="kicker">
            No setup, no questionnaire, no mood picker. AURA starts learning from
            the very first song.
          </p>
        </div>

        <div className="steps-3d">
          {/* Step 1 — SENSE */}
          <div className="step-card">
            <span className="step-num">01 &middot; SENSE</span>
            <h3>Knows how you <em>feel.</em></h3>
            <div className="step-vis">
              <svg viewBox="0 0 200 120">
                <defs>
                  <radialGradient id="rg1" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#b06a3f" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#b06a3f" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="100" cy="60" r="55" fill="url(#rg1)">
                  {!reduceMotion && (
                    <animate attributeName="r" values="50;58;50" dur="3s" repeatCount="indefinite" />
                  )}
                </circle>
                <circle cx="100" cy="60" r="32" fill="none" stroke="#b06a3f" strokeWidth="0.8" opacity="0.8" />
                <circle cx="100" cy="60" r="6" fill="#b06a3f" />
                <text x="100" y="105" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="7" fill="currentColor" fillOpacity="0.7" letterSpacing="0.7" style={{ textTransform: 'uppercase' }}>mood read &middot; 0.78</text>
              </svg>
            </div>
            <p className="step-body">
              AURA picks up your mood from the time of day, what you play, and what
              you skip — no questions, no setup.
            </p>
          </div>

          {/* Step 2 — CONNECT */}
          <div className="step-card">
            <span className="step-num">02 &middot; CONNECT</span>
            <h3>Connects the <em>songs.</em></h3>
            <div className="step-vis">
              <svg viewBox="0 0 200 120">
                <path d="M10 100 Q60 30 100 60 Q140 90 190 30" stroke="#b06a3f" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <circle cx="10" cy="100" r="5" fill="#b06a3f" />
                <circle cx="60" cy="55" r="4" fill="#b06a3f" opacity="0.7" />
                <circle cx="100" cy="60" r="6" fill="#b06a3f" />
                <circle cx="140" cy="68" r="4" fill="#b06a3f" opacity="0.7" />
                <circle cx="190" cy="30" r="5" fill="#b06a3f" />
                <text x="10" y="115" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="600" fontSize="9" fill="currentColor" fillOpacity="0.7">energetic</text>
                <text x="190" y="20" textAnchor="end" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="600" fontSize="9" fill="currentColor" fillOpacity="0.7">focused</text>
              </svg>
            </div>
            <p className="step-body">
              Each next song is picked so the change in mood feels gradual. Matching
              tempo, key, and lyrics — chosen for how it flows, not just the song
              itself.
            </p>
          </div>

          {/* Step 3 — ADAPT */}
          <div className="step-card">
            <span className="step-num">03 &middot; ADAPT</span>
            <h3>Adjusts in <em>real time.</em></h3>
            <div className="step-vis">
              <svg viewBox="0 0 200 120">
                {/* you bubble — soft accent, top-left */}
                <g>
                  <rect x="14" y="18" width="68" height="38" rx="10" fill="rgba(176,106,63,0.18)" stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.8" />
                  <text x="48" y="37" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="600" fontSize="12" fill="currentColor">you</text>
                  <text x="48" y="49" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="6.5" fill="currentColor" fillOpacity="0.55" letterSpacing="0.6" style={{ textTransform: 'uppercase' }}>quieter</text>
                </g>
                {/* connector — dashed accent arrow from you → aura */}
                <line x1="82" y1="52" x2="110" y2="69" stroke="#b06a3f" strokeWidth="1" strokeDasharray="3 2" strokeLinecap="round" />
                <polygon points="116,73 107,72 111,65" fill="#b06a3f" />
                {/* aura bubble — ink-filled, bottom-right */}
                <g>
                  <rect x="118" y="64" width="68" height="38" rx="10" fill="var(--color-ink)" />
                  <text x="152" y="83" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="600" fontSize="12" fill="var(--color-bg)">aura</text>
                  <text x="152" y="95" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="6.5" fill="var(--color-bg)" fillOpacity="0.65" letterSpacing="0.6" style={{ textTransform: 'uppercase' }}>rebuilding</text>
                </g>
              </svg>
            </div>
            <p className="step-body">
              Just say it — &ldquo;take me somewhere quieter&rdquo;, &ldquo;something
              heavier&rdquo;, &ldquo;remind me of last fall&rdquo;. AURA replies in
              plain words and rebuilds the queue without skipping a beat.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   FEATURE SPOTLIGHTS — full-bleed bands showing the REAL in-app components
   (not mockups), each fed static data so they run with no auth/API/audio.
   ══════════════════════════════════════════════════════════════════════ */
function FeatureSpotlights({ analyser, isPlaying }) {
  // A Fragment (not a wrapper div) so each band is a DIRECT child of .lp-stack —
  // sticky stacking needs all stages to share one containing block to cover/stack.
  return (
    <>
      <FeatureBand
        id="bridges"
        eyebrow="the flagship · mood bridges"
        title={<>Move from one mood<br /><em>to another.</em></>}
        copy="Tell AURA where you are and where you want to be — it threads real songs to carry you there, one gentle step at a time. Pick a path and watch it redraw."
      >
        <MoodBridgesSpotlight />
      </FeatureBand>

      <FeatureBand
        flip
        id="lyrics"
        eyebrow="lyrics, reimagined"
        title={<>Your song&apos;s words,<br /><em>lit line by line.</em></>}
        copy="Stop touching the screen and the lyrics take over — the song's words drifting over its album art, lit line by line. Press play to watch it move."
      >
        <LyricsSpotlight analyser={analyser} isPlaying={isPlaying} />
      </FeatureBand>

      <FeatureBand
        id="themes"
        eyebrow="make it yours · themes"
        title={<>Three moods,<br /><em>one tap away.</em></>}
        copy="Warm light, dark, or soft pink. Switch any time and the whole app follows — try it here on real components."
      >
        <ThemesSpotlight />
      </FeatureBand>

      <FeatureBand
        flip
        id="sensing"
        eyebrow="it reads the room · mood sensing"
        title={<>It already knows<br /><em>how you feel.</em></>}
        copy="No mood picker, no questionnaire. From the time of day and what you play, AURA reads the moment the second you open it. Run the read again."
      >
        <SensingSpotlight />
      </FeatureBand>

      <FeatureBand
        id="orbit"
        eyebrow="straight back in · quick picks"
        title={<>Your rotation,<br /><em>in orbit.</em></>}
        copy="The songs you reach for most, circling one tap from play. Hover a disc to lift it; spin the hub to shuffle them all."
      >
        <OrbitSpotlight analyser={analyser} isPlaying={isPlaying} />
      </FeatureBand>

      <FeatureBand
        flip
        id="talk"
        eyebrow="say it out loud · talk to your DJ"
        title={<>Just tell AURA<br /><em>what you want.</em></>}
        copy="No menus, no mood sliders. Say it in plain words and AURA reshapes the queue on the spot. Tap a line to try it."
      >
        <TalkAuraSpotlight />
      </FeatureBand>

      <FeatureBand
        id="equalizer"
        eyebrow="dial in the sound · equalizer"
        title={<>Tune the sound<br /><em>to your ears.</em></>}
        copy="An 8-band equalizer with presets, volume, and three quality tiers — open it and drag the curve. Highest quality by default."
      >
        <EqualizerSpotlight />
      </FeatureBand>

      <FeatureBand
        flip
        id="player"
        eyebrow="the now playing · player"
        title={<>A player that<br /><em>breathes.</em></>}
        copy="Album art that morphs between tracks, a scrub ribbon you can grab, transport in the thumb zone. Press play."
      >
        <PlayerSpotlight />
      </FeatureBand>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   FEATURE GRID — six cards
   ══════════════════════════════════════════════════════════════════════ */
function FeatureGrid() {
  return (
    <section className="lp-body features-body">
      <div className="section-head">
        <span className="mono">03 &middot; everything else it does</span>
        <h2>
          Six small things<br />
          <em>nobody else is doing.</em>
        </h2>
        <p className="kicker">
          All built on one idea: a music app should feel like a calm companion, not
          an endless feed.
        </p>
      </div>

      <div className="feature-grid">
        <article className="feature">
          <span className="icon-wrap">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 5 L10 10 L13 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <h4>Why <em>this song.</em></h4>
          <p>
            Tap any song and AURA tells you, in plain words, why it picked it — what
            matched, and what it skipped over. Recommendations you can actually
            understand.
          </p>
          <span className="tag">clear</span>
        </article>

        <article className="feature">
          <span className="icon-wrap">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M2 14 Q7 4 10 4 Q13 4 18 14" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              <circle cx="2" cy="14" r="1.6" fill="currentColor" />
              <circle cx="18" cy="14" r="1.6" fill="currentColor" />
            </svg>
          </span>
          <h4>Mood <em>bridges.</em></h4>
          <p>
            &ldquo;Take me from energetic to focused in eighteen minutes.&rdquo;
            AURA builds a run of songs that shift your mood one step at a time.
          </p>
          <span className="tag">novel</span>
        </article>

        <article className="feature">
          <span className="icon-wrap">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 3 H16 V17 H4 Z" stroke="currentColor" strokeWidth="1.4" fill="none" />
              <path d="M7 7 H13 M7 10 H13 M7 13 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <h4>Listening <em>journal.</em></h4>
          <p>
            Private, AI-written notes on what you played and why. &ldquo;You skipped
            twice at the chorus, so AURA eased off the big, building tracks.&rdquo;
          </p>
          <span className="tag">private</span>
        </article>

        <article className="feature">
          <span className="icon-wrap">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 2 L10 18 M2 10 L18 10 M4.5 4.5 L15.5 15.5 M15.5 4.5 L4.5 15.5" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
              <circle cx="10" cy="10" r="3.5" fill="currentColor" opacity="0.4" />
            </svg>
          </span>
          <h4>Your music <em>profile.</em></h4>
          <p>
            Your taste, at a glance. Six traits — pace, mood, sound, lyrics,
            familiarity, discovery — that shift over time. Watch how your taste
            changes.
          </p>
          <span className="tag">analytics</span>
        </article>

        <article className="feature">
          <span className="icon-wrap">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 6 L10 10 L13 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
            </svg>
          </span>
          <h4>Bringing songs <em>back.</em></h4>
          <p>
            &ldquo;You haven&apos;t heard this in fourteen months. Back then it felt
            gentle, and tonight feels close.&rdquo; AURA brings back songs you&apos;ve
            forgotten at the right moment.
          </p>
          <span className="tag">timely</span>
        </article>

        <article className="feature">
          <span className="icon-wrap">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="7" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="14" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2 16 Q7 12 12 16" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </span>
          <h4>With <em>you.</em></h4>
          <p>
            See how many others are in the same mood, playing the same song right
            now. Anonymous and low-key — you feel the company without the crowd.
          </p>
          <span className="tag">low-key</span>
        </article>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   DNA SHOWCASE — dark section, hexagonal radar
   ══════════════════════════════════════════════════════════════════════ */
function DnaShowcase() {
  return (
    <section className="lp-body dna-section">
      <div className="dna-inner">
        <div className="dna-radar" aria-hidden="true">
          <svg viewBox="-50 -50 500 500" style={{ width: '100%', height: '100%' }}>
            <defs>
              <radialGradient id="dna-fill" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#d6a988" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#d6a988" stopOpacity="0.1" />
              </radialGradient>
            </defs>
            <g transform="translate(200,200)">
              {/* grid hexagons */}
              <polygon points="0,-160 138.6,-80 138.6,80 0,160 -138.6,80 -138.6,-80" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.8" />
              <polygon points="0,-120 103.9,-60 103.9,60 0,120 -103.9,60 -103.9,-60" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="0.8" />
              <polygon points="0,-80 69.3,-40 69.3,40 0,80 -69.3,40 -69.3,-40" fill="none" stroke="currentColor" strokeOpacity="0.10" strokeWidth="0.8" />
              <polygon points="0,-40 34.6,-20 34.6,20 0,40 -34.6,20 -34.6,-20" fill="none" stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.8" />

              {/* axes */}
              <line x1="0" y1="0" x2="0" y2="-160" stroke="currentColor" strokeOpacity="0.10" />
              <line x1="0" y1="0" x2="138.6" y2="-80" stroke="currentColor" strokeOpacity="0.10" />
              <line x1="0" y1="0" x2="138.6" y2="80" stroke="currentColor" strokeOpacity="0.10" />
              <line x1="0" y1="0" x2="0" y2="160" stroke="currentColor" strokeOpacity="0.10" />
              <line x1="0" y1="0" x2="-138.6" y2="80" stroke="currentColor" strokeOpacity="0.10" />
              <line x1="0" y1="0" x2="-138.6" y2="-80" stroke="currentColor" strokeOpacity="0.10" />

              {/* user shape (pace 34, mood 68, sound 41, lyrics 78, familiarity 42, discovery 58) */}
              <polygon points="0,-54.4 94.2,-54.4 56.7,32.8 0,124.8 -58.2,33.6 -80.3,-46.4" fill="url(#dna-fill)" stroke="#d6a988" strokeWidth="1.8" />

              {/* vertices */}
              <circle cx="0" cy="-54.4" r="4" fill="#d6a988" />
              <circle cx="94.2" cy="-54.4" r="4" fill="#d6a988" />
              <circle cx="56.7" cy="32.8" r="4" fill="#d6a988" />
              <circle cx="0" cy="124.8" r="4" fill="#d6a988" />
              <circle cx="-58.2" cy="33.6" r="4" fill="#d6a988" />
              <circle cx="-80.3" cy="-46.4" r="4" fill="#d6a988" />

              {/* axis labels */}
              <text x="0" y="-188" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="11" fill="currentColor" fillOpacity="0.6" letterSpacing="0.88" style={{ textTransform: 'uppercase' }}>pace</text>
              <text x="170" y="-90" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="11" fill="currentColor" fillOpacity="0.6" letterSpacing="0.88" style={{ textTransform: 'uppercase' }}>mood</text>
              <text x="170" y="92" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="11" fill="currentColor" fillOpacity="0.6" letterSpacing="0.88" style={{ textTransform: 'uppercase' }}>sound</text>
              <text x="0" y="194" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="11" fill="currentColor" fillOpacity="0.6" letterSpacing="0.88" style={{ textTransform: 'uppercase' }}>lyrics</text>
              <text x="-170" y="92" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="11" fill="currentColor" fillOpacity="0.6" letterSpacing="0.88" style={{ textTransform: 'uppercase' }}>familiarity</text>
              <text x="-170" y="-90" textAnchor="middle" fontFamily="Hanken Grotesk, system-ui, sans-serif" fontWeight="500" fontSize="11" fill="currentColor" fillOpacity="0.6" letterSpacing="0.88" style={{ textTransform: 'uppercase' }}>discovery</text>
            </g>
          </svg>
        </div>

        <div>
          <div className="section-head" style={{ marginBottom: 32 }}>
            <span className="mono">04 &middot; your music profile</span>
            <h2>
              Your taste,<br />
              <em>at a glance.</em>
            </h2>
            <p className="kicker">
              Not just a top-artists list. Six traits that move with you over time —
              and show AURA how your taste is changing.
            </p>
          </div>

          <div className="dna-stats">
            <div className="dna-stat">
              <span className="label">SIGNATURE THIS MONTH</span>
              <span className="value">easygoing &middot; lyric-driven &middot; curious</span>
            </div>
            <div className="dna-stat">
              <span className="label">DRIFT</span>
              <span className="value">
                warmer mood{' '}
                <em data-count="0.12" data-prefix="+" style={{ fontStyle: 'normal', color: '#d6a988' }}>+0.12</em>
              </span>
              <span className="stat-meta">
                a small shift toward more spacious, open tracks — though you&apos;re
                still on slower songs at night.
              </span>
            </div>
            <div className="dna-stat">
              <span className="label">THIS MONTH</span>
              <span className="value">
                <span data-count="47">47</span> hrs &middot;{' '}
                <span data-count="23">23</span> artists &middot;{' '}
                <span data-count="31">31</span> new &middot;{' '}
                <span data-count="8">8</span> returns
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   VISION — quote + three pillars
   ══════════════════════════════════════════════════════════════════════ */
function VisionSection() {
  return (
    <section className="lp-body vision-body">
      <div className="section-head">
        <span className="mono">05 &middot; vision &amp; mission</span>
        <h2>
          Why we&apos;re<br />
          <em>building this.</em>
        </h2>
      </div>

      <div className="vision-grid">
        <div>
          <blockquote className="vision-quote">
            We don&apos;t want to be the next Spotify. We want to be the music app
            that, for the first time in twenty years, makes you feel like the
            machine on the other side is <em>actually listening.</em>
          </blockquote>
          <div className="vision-attr">
            <div className="avatar" />
            <div>
              <div className="who">aura</div>
              <div className="role">founder</div>
            </div>
          </div>
        </div>

        <div className="pillars">
          <div className="pillar">
            <h4>OUR VISION</h4>
            <h5>
              A world where every song you hear was chosen to fit the moment,{' '}
              <em className="italic">not just to keep you clicking.</em>
            </h5>
            <p>
              Recommendations today feel like a slot machine. We want them to feel
              like a friend who knows exactly what you need at 9:47 pm on a Tuesday.
            </p>
          </div>
          <div className="pillar">
            <h4>OUR MISSION</h4>
            <h5>
              To build the first music companion that{' '}
              <em className="italic">infers, explains, and adapts.</em>
            </h5>
            <p>
              Three promises: never ask what we can figure out. Always tell you why.
              Always adjust when you push back.
            </p>
          </div>
          <div className="pillar">
            <h4>OUR VALUES</h4>
            <h5>Private, patient, plain-spoken.</h5>
            <p>
              Your listening journal is yours alone. The queue never overreacts. The
              AI never talks like an ad.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   TESTIMONIALS — three cards
   ══════════════════════════════════════════════════════════════════════ */
function TestimonialsSection() {
  const stars = (
    <div className="stars">
      <span>&#9679;</span>
      <span>&#9679;</span>
      <span>&#9679;</span>
      <span>&#9679;</span>
      <span>&#9679;</span>
    </div>
  );

  return (
    <section className="lp-body testimonials-section">
      <div className="test-inner">
        <div className="section-head" style={{ textAlign: 'center', margin: '0 auto 60px' }}>
          <span className="mono">early voices</span>
          <h2 style={{ marginTop: 14 }}>
            From<br />
            <em>early users.</em>
          </h2>
        </div>
        <div className="test-grid">
          <article className="test-card">
            {stars}
            <blockquote>
              I asked Aura for &ldquo;something quieter&rdquo; and it apologised for
              the last track. I have never been apologised to by an algorithm
              before.
            </blockquote>
            <div className="tc-meta">
              <div className="avatar" style={{ background: 'linear-gradient(135deg, #264b7a, #9ec5ff)' }} />
              <div>
                <div className="who">Tomi S.</div>
                <div className="role">tokyo &middot; early access</div>
              </div>
            </div>
          </article>

          <article className="test-card">
            {stars}
            <blockquote>
              The &ldquo;why this song&rdquo; panel turned out to be the killer
              feature. I finally trust the recommendations because I can see how the
              math works.
            </blockquote>
            <div className="tc-meta">
              <div className="avatar" style={{ background: 'linear-gradient(135deg, #2f5b42, #a8d8b0)' }} />
              <div>
                <div className="who">Isabella M.</div>
                <div className="role">mexico city &middot; early access</div>
              </div>
            </div>
          </article>

          <article className="test-card">
            {stars}
            <blockquote>
              Mood Bridges are wild. I went from energetic to focused in six songs
              without noticing. I just looked up and my shoulders had dropped.
            </blockquote>
            <div className="tc-meta">
              <div className="avatar" style={{ background: 'linear-gradient(135deg, #3a2b6b, #b8a4ff)' }} />
              <div>
                <div className="who">Amir K.</div>
                <div className="role">berlin &middot; early access</div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   FINAL CTA — store badges
   ══════════════════════════════════════════════════════════════════════ */
function FinalCTA({ onNavigateAuth }) {
  return (
    <section className="final-cta">
      <h2>
        Let AURA<br />
        <em>set the mood tonight.</em>
      </h2>
      <p className="lead">
        Free during early access. On the web now, iOS coming soon. No credit card.
        No spam. Cancel anytime — though you won&apos;t want to.
      </p>
      <div className="ctas">
        <button className="btn btn-primary" type="button" onClick={() => onNavigateAuth('signup')}>
          Create your account
          <ArrowSvg />
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => onNavigateAuth('signup')}>
          Try AURA
        </button>
      </div>
      <div className="stores">
        <button className="store-badge" type="button" onClick={() => toast('coming soon.')}>
          <svg width="18" height="20" viewBox="0 0 18 20" fill="currentColor">
            <path d="M13.6 10.6c0-2.5 2-3.7 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8C3.6 5 2 6 1.2 7.6c-1.7 3-.4 7.4 1.3 9.8.8 1.2 1.8 2.5 3.1 2.4 1.2-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.3.9-1.3 1.3-2.6 1.4-2.7-.1 0-2.7-1-2.7-4.1zM11.3 3.4c.7-.8 1.1-2 1-3.2C11.2.3 9.9 1 9.2 1.9c-.6.7-1.2 1.9-1 3.1 1.2.1 2.4-.6 3.1-1.6z" />
          </svg>
          <div>
            <span className="small">Coming to</span>
            <span className="big">App Store</span>
          </div>
        </button>
        <button className="store-badge" type="button" onClick={() => toast('coming soon.')}>
          <svg width="18" height="20" viewBox="0 0 18 20" fill="currentColor">
            <path d="M.6 1.4C.2 1.8 0 2.4 0 3.2v13.6c0 .8.2 1.4.6 1.8L8.6 10 .6 1.4zm1.8 17.5l9.3-5.3-2.3-2.4-7 7.7zM17 8.7L13.7 6.9 11.2 9.4l2.5 2.5 3.3-1.8c1-.6 1-2 0-2.4zM2.4 1.1l7 7.7 2.3-2.3L2.4 1.1z" />
          </svg>
          <div>
            <span className="small">Coming to</span>
            <span className="big">Google Play</span>
          </div>
        </button>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   FOOTER
   ══════════════════════════════════════════════════════════════════════ */
function Footer({ onNavigateAuth, onNavigate }) {
  const scrollTo = useCallback(
    (id) => (e) => {
      e.preventDefault();
      landingScrollTo(document.getElementById(id));
    },
    [],
  );
  const goAuth = useCallback(
    (mode) => (e) => {
      e.preventDefault();
      onNavigateAuth(mode);
    },
    [onNavigateAuth],
  );
  const goTo = useCallback(
    (path) => (e) => {
      e.preventDefault();
      onNavigate?.(path);
    },
    [onNavigate],
  );
  const stub = useCallback((e) => {
    e.preventDefault();
    toast('coming soon.');
  }, []);

  return (
    <footer>
      <div className="footer-grid">
        <div className="footer-brand">
          <button className="brand" type="button" onClick={scrollTo('top')}>
            <AuraMark size={20} />
            <span>aura</span>
          </button>
          <p>
            AURA FM — music that gets how you feel. A calm AI radio built around your
            real mood, not what the algorithm assumes.
          </p>
        </div>
        <div className="footer-col">
          <h6>Product</h6>
          <ul>
            <li><a href="#how" onClick={scrollTo('how')}>How it works</a></li>
            <li><a href="#features" onClick={scrollTo('features')}>Features</a></li>
            <li><a href="#" onClick={goAuth('signup')}>Try AURA</a></li>
            <li><a href="#" onClick={goAuth('signup')}>Onboarding</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <h6>Company</h6>
          <ul>
            <li><a href="#vision" onClick={scrollTo('vision')}>Vision</a></li>
            <li><a href="#" onClick={stub}>Manifesto</a></li>
            <li><a href="#" onClick={stub}>Press</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <h6>Account</h6>
          <ul>
            <li><a href="#" onClick={goAuth('signin')}>Sign in</a></li>
            <li><a href="#" onClick={goAuth('signup')}>Create account</a></li>
            <li><a href="/privacy" onClick={goTo('/privacy')}>Privacy</a></li>
            <li><a href="/terms" onClick={goTo('/terms')}>Terms</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>&copy; 2026 AURA FM</span>
        <span>made with aura</span>
      </div>
    </footer>
  );
}

/* A plain flow wrapper grouping each major section; `.lp-stage__inner` is the
   element runLandingAnimations fades + parallax-drifts. `id` carries the nav
   anchor. (The old sticky-cover model is gone; these are normal-flow blocks.) */
function Stage({ children, id }) {
  return (
    <div className="lp-stage" id={id}>
      <div className="lp-stage__inner">{children}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   LANDING PAGE — main export

   Contract: LandingPage({ onNavigateAuth, theme, onToggleTheme }).
   The theme class is owned by the caller (main.jsx wraps both pre-auth pages
   in `theme-${theme}`), so this root carries no theme class of its own — but
   the nav's light/dark toggle calls back up via onToggleTheme.

   Layout: the nav is fixed (outside the scrolled content). Everything that
   scrolls lives in .lp-scroll — Lenis's content element. Sections flow normally
   (the .lp-stage wrappers are plain grouping blocks now); GSAP adds the parallax
   + scroll-linked reveals on top.
   ══════════════════════════════════════════════════════════════════════ */
export function LandingPage({ onNavigateAuth, onNavigate, theme, onToggleTheme }) {
  const rootRef = useRef(null);
  useGsap(rootRef, runLandingAnimations);
  // The hero orb owns the only audio source; lift it here so the orb AND the
  // lyrics / orbit spotlights can react to one shared analyser + play state.
  const audio = useHeroOrbAudio();

  return (
    <div className="aura-landing" ref={rootRef}>
      <CursorFollower />
      <TopNav onNavigateAuth={onNavigateAuth} theme={theme} onToggleTheme={onToggleTheme} />
      <div className="lp-scroll">
        <div className="lp-stack">
          <Stage id="top">
            <Hero onNavigateAuth={onNavigateAuth} audio={audio} />
            <Marquee />
          </Stage>
          <Stage id="problem"><ProblemSection /></Stage>
          <Stage id="how"><HowItWorksSection /></Stage>
          <FeatureSpotlights analyser={audio.analyser} isPlaying={audio.isPlaying} />
          <Stage id="features"><FeatureGrid /></Stage>
          <Stage id="dna"><DnaShowcase /></Stage>
          <Stage id="vision"><VisionSection /></Stage>
          <Stage><TestimonialsSection /></Stage>
          <Stage id="pricing"><FinalCTA onNavigateAuth={onNavigateAuth} /></Stage>
        </div>
        <Footer onNavigateAuth={onNavigateAuth} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

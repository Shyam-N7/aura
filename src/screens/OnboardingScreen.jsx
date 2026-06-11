import { useEffect, useMemo, useState } from 'react';
import { SEED_ARTIST_FALLBACK } from '../data/seedArtists';
import { setSeedArtists, setSeedSignals, markOnboarded } from '../lib/onboarding';
import { AlbumArt } from '../components/album/AlbumArt';
import { AuraMark } from '../components/primitives';
import { getDiscoverHome } from '../api/discover';
import './OnboardingScreen.css';

const PICK_TARGET = 3;
const MAX_TILES   = 12;

const LANGUAGES = ['tamil', 'english', 'hindi', 'malayalam', 'kannada'];

// Six moods with the visual metadata each card carries: a 135° linear-gradient
// swatch (left of the card), a small line-art icon centered inside the swatch
// that says what the mood *feels* like (focal dot for focused, crescent for
// late-night, etc.), and a two-word subtitle that says what the label means.
// Palette is muted-warm and saturation-shifted toward AURA's dusk temperature
// axis — no Tailwind-primary blues / greens / purples that would jump out of
// the warm-cream + ink-brown family the rest of the UI lives in.
const MOODS = [
  { key: 'focused',     label: 'Focus',      sub: 'For concentration',  swatch: 'linear-gradient(135deg, #6e85a3, #475c7a)', icon: <FocusedIcon/>     },
  { key: 'unwound',     label: 'Chill',      sub: 'Wind down',          swatch: 'linear-gradient(135deg, #c4a36e, #976e3f)', icon: <UnwoundIcon/>     },
  { key: 'in-motion',   label: 'Energy',     sub: 'Get pumped',         swatch: 'linear-gradient(135deg, #c47554, #934530)', icon: <InMotionIcon/>    },
  { key: 'late-night',  label: 'Late Night', sub: 'After-hours vibes',  swatch: 'linear-gradient(135deg, #466855, #2a3f33)', icon: <LateNightIcon/>   },
  { key: 'curious',     label: 'Discover',   sub: 'Try new music',      swatch: 'linear-gradient(135deg, #8970a0, #5c4878)', icon: <CuriousIcon/>     },
  { key: 'remembering', label: 'Throwback',  sub: 'Old favorites',      swatch: 'linear-gradient(135deg, #b08e6a, #7e5e3e)', icon: <RememberingIcon/> },
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

// First-run "pick three" screen — two-column editorial layout with three
// signals (language, mood, artists). Language pills filter the artist grid
// live; mood + language each light their checklist row as they're set. All
// three sections are skippable.
export function OnboardingScreen({ pool = [], onDone, onSkip }) {
  const [selectedLangs, setSelectedLangs] = useState(() => new Set());
  const [selectedMood,  setSelectedMood]  = useState(null);
  // `picks` is an ORDERED array, not a Set — we need FIFO replacement when
  // the user taps a 4th tile (oldest pick drops out, new one takes its slot).
  const [picks,         setPicks]         = useState(() => []);
  // How many artist tiles are revealed. Starts at one page; "load more" grows it
  // so a user who doesn't like the first dozen can pull in the rest of the pool.
  const [visibleCount,  setVisibleCount]  = useState(MAX_TILES);
  // Trending tracks pulled on mount. Used as the primary artist source — the
  // `pool` prop is a fallback while trending loads (and if it fails).
  const [trending, setTrending] = useState([]);

  useEffect(() => {
    const ctl = new AbortController();
    getDiscoverHome({ signal: ctl.signal })
      .then(data => setTrending(Array.isArray(data?.trending) ? data.trending : []))
      .catch(() => { /* fall through to pool */ });
    return () => ctl.abort();
  }, []);

  // Prefer trending when it's hydrated; fall back to the featured pool so the
  // grid never renders empty during the ~200 ms trending fetch.
  const source = trending.length >= 6 ? trending : pool;
  const allTiles = useMemo(() => buildTiles(source), [source]);
  const tiles = useMemo(() => {
    if (selectedLangs.size === 0) return allTiles;
    return allTiles.filter(t => !t.language || selectedLangs.has(String(t.language).toLowerCase()));
  }, [allTiles, selectedLangs]);
  const visibleTiles = tiles.slice(0, visibleCount);
  const canLoadMore  = tiles.length > visibleCount;

  const toggleLang = (L) => setSelectedLangs(prev => {
    const next = new Set(prev);
    if (next.has(L)) next.delete(L); else next.add(L);
    return next;
  });

  const toggleMood = (key) => setSelectedMood(prev => prev === key ? null : key);

  // FIFO smart cap. Tapping a 4th replaces the first picked.
  const togglePick = (name) => setPicks(prev => {
    if (prev.includes(name)) return prev.filter(n => n !== name);
    if (prev.length >= PICK_TARGET) return [...prev.slice(1), name];
    return [...prev, name];
  });

  const stepsDone = (selectedLangs.size > 0 ? 1 : 0)
                  + (selectedMood ? 1 : 0)
                  + (picks.length === PICK_TARGET ? 1 : 0);
  const progressPct = (stepsDone / 3) * 100;
  const langStep    = selectedLangs.size > 0 ? 'done' : 'active';
  const moodStep    = selectedMood             ? 'done' : (selectedLangs.size > 0 ? 'active' : 'pending');
  const artistStep  = picks.length === PICK_TARGET ? 'done' : (selectedMood ? 'active' : 'pending');
  const selectedMoodMeta = MOODS.find(m => m.key === selectedMood);

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

  const skip = () => {
    setSeedArtists([]);
    setSeedSignals({ languages: [], mood: null });
    markOnboarded();
    (onSkip ?? onDone)?.([]);
  };

  const canSubmit = picks.length === PICK_TARGET;

  return (
    <div className="aura-onb">
      {/* top viewport progress strip — accent fill advances 33% per step */}
      <div className="aura-onb__top-strip">
        <div className="aura-onb__top-strip-fill" style={{ width: `${progressPct}%` }}/>
      </div>

      <div className="aura-onb__shell">
        {/* ─── Left rail: brand + headline + checklist ─────────────────── */}
        <aside className="aura-onb__rail">
          <div className="aura-onb__brand">
            <span className="aura-onb__brand-icon"><AuraMark size={20}/></span>
            <span className="aura-onb__brand-text">aura welcomes you!</span>
            <span className="aura-onb__brand-welcome">aura welcomes you!</span>
          </div>
          <h1 className="aura-onb__title">
            Let&apos;s find <em>your sound</em>.
          </h1>
          <p className="aura-onb__sub">
            Three quick questions. You can change any answer later.
          </p>
          <div className="aura-onb__rail-divider"/>
          <ol className="aura-onb__stepper" aria-label="Setup progress">
            <StepperNode n={1} label="Language" status={langStep}/>
            <StepperNode n={2} label="Mood"     status={moodStep}/>
            <StepperNode n={3} label="Artists"  status={artistStep}/>
          </ol>
        </aside>

        {/* ─── Right column: three sections ─────────────────────────────── */}
        <main className="aura-onb__main">
          {/* 01 — Languages */}
          <section className="aura-onb__step">
            <header className="aura-onb__step-header">
              <span className="aura-onb__step-num">01</span>
              <h2 className="aura-onb__step-title">What languages do you listen to?</h2>
              {selectedLangs.size > 0 && (
                <span className="aura-onb__step-meta">
                  {selectedLangs.size} selected &middot; {tiles.length} artists below
                </span>
              )}
            </header>
            <div className="aura-onb__chiprow">
              {LANGUAGES.map(L => {
                const on = selectedLangs.has(L);
                return (
                  <button key={L} type="button" onClick={() => toggleLang(L)}
                    className={`aura-onb__chip ${on ? 'aura-onb__chip--on' : ''}`}>
                    <span className="aura-onb__chip-dot">
                      {on && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                          <path d="M2 5 L4 7 L8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    {L.charAt(0).toUpperCase() + L.slice(1)}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 02 — Moods */}
          <section className="aura-onb__step">
            <header className="aura-onb__step-header">
              <span className="aura-onb__step-num">02</span>
              <h2 className="aura-onb__step-title">How do you feel?</h2>
              {selectedMoodMeta && (
                <span className="aura-onb__step-meta aura-onb__step-meta--quote">
                  &ldquo;{selectedMoodMeta.label}&rdquo;
                </span>
              )}
            </header>
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
          </section>

          {/* 03 — Artists */}
          <section className="aura-onb__step">
            <header className="aura-onb__step-header">
              <span className="aura-onb__step-num">03</span>
              <h2 className="aura-onb__step-title">Pick three artists you love.</h2>
              <span className="aura-onb__step-meta">{picks.length} of 3</span>
            </header>
            <div className="aura-onb__grid">
              {visibleTiles.map((t, i) => {
                const on = picks.includes(t.name);
                return (
                  <button key={t.name} type="button" onClick={() => togglePick(t.name)}
                    style={{ '--i': i }}
                    className={`aura-onb__tile ${on ? 'aura-onb__tile--on' : ''}`}>
                    <div className="aura-onb__tile-art">
                      <AlbumArt
                        track={{ id: t.sampleTrackId, imageUrl: t.imageUrl, artist: t.name, cover: coverFor(i) }}
                        radius={10}
                        style={{ width: '100%', height: '100%', aspectRatio: 1 }}/>
                      {t.language && (
                        <span className="aura-onb__tile-lang">{t.language}</span>
                      )}
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
                    <div className={`aura-onb__tile-cta ${on ? 'aura-onb__tile-cta--on' : ''}`}>
                      {on ? 'Selected' : 'Tap to add'}
                    </div>
                  </button>
                );
              })}
              {tiles.length === 0 && (
                <div className="aura-onb__empty">
                  No artists in those languages yet. Try selecting more languages.
                </div>
              )}
            </div>
            {canLoadMore && (
              <button type="button" className="aura-onb__loadmore"
                onClick={() => setVisibleCount(c => c + 8)}>
                Load more artists
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                  <path d="M6.5 2.5 V10.5 M2.5 6.5 H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </section>
        </main>
      </div>

      {/* ─── Sticky bottom dock ─────────────────────────────────────────── */}
      <div className="aura-onb__dock">
        <button type="button" onClick={skip} className="aura-onb__dock-skip">Skip</button>
        <span className="aura-onb__dock-divider"/>
        <div className="aura-onb__dock-progress">
          <div className="aura-onb__dock-progress-fill" style={{ width: `${(picks.length / PICK_TARGET) * 100}%` }}/>
        </div>
        <div className="aura-onb__dock-count">
          <span className={picks.length > 0 ? 'aura-onb__dock-count-current' : ''}>{picks.length}</span>
          {' of '}
          <span className="aura-onb__dock-count-target">{PICK_TARGET}</span>
        </div>
        <button type="button" onClick={submit} disabled={!canSubmit} className="aura-onb__dock-submit">
          Get Started
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
            <path d="M1 5 H12 M8 1 L12 5 L8 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function StepperNode({ n, label, status }) {
  return (
    <li className={`aura-onb__step-node aura-onb__step-node--${status}`}>
      <span className="aura-onb__step-dot">
        {status === 'done' ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M2 5.6 L4.4 8 L9 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : n}
      </span>
      <span className="aura-onb__step-label">{label}</span>
    </li>
  );
}

// Rotate procedural cover patterns for the fallback artist tiles. The catalog pool
// usually carries imageUrls, so this only kicks in for SEED_ARTIST_FALLBACK
// entries — keeps the grid visually varied instead of 12 monogram squares.
const COVER_ROTATION = ['rings', 'bands', 'circle', 'split'];
function coverFor(i) { return COVER_ROTATION[i % COVER_ROTATION.length]; }

function buildTiles(pool) {
  const seen = new Map();
  for (const t of pool) {
    const name = t.artist?.trim();
    if (!name) continue;
    if (!seen.has(name)) {
      seen.set(name, { name, language: t.language ?? null, imageUrl: t.imageUrl ?? null, sampleTrackId: t.id });
    } else if (!seen.get(name).imageUrl && t.imageUrl) {
      seen.get(name).imageUrl = t.imageUrl;
    }
  }
  // Return the FULL deduped pool (not capped at MAX_TILES) — the screen reveals
  // a page at a time via `visibleCount`, so "load more" can pull in everything
  // trending surfaced plus the seed fallbacks the user hasn't seen yet.
  const fromPool = Array.from(seen.values());
  const have = new Set(fromPool.map(t => t.name));
  const fill = SEED_ARTIST_FALLBACK.filter(t => !have.has(t.name));
  return [...fromPool, ...fill];
}

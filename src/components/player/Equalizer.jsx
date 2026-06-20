import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MonoLabel } from '../primitives';
import { VolumeSlider } from './VolumeSlider';
import { EQ_FREQS, EQ_LABELS, EQ_RANGE_DB, EQ_PRESETS, gainsMatch } from '../../audio/eqConfig';
import { QUALITIES } from '../../lib/audioQuality';
import { useAudioQuality } from '../../hooks/useAudioQuality';
import { useEqUserPresets } from '../../hooks/useEqUserPresets';
import { saveEqUserPreset, deleteEqUserPreset, MAX_PRESETS } from '../../lib/eqPresets';
import { prompt } from '../../lib/prompt';
import { confirm } from '../../lib/confirm';
import { toast } from '../../lib/toast';
import { isIOS } from '../../lib/platform';
import './Equalizer.css';

// Curve-fader geometry. The cell width + track height are computed per-open from
// the viewport (see eqGeometry) so the panel can render as a compact popup on
// desktop and a large near-fullscreen sheet on phones, sharing one coordinate
// system between the SVG response curve and the fader columns.
const COLS = EQ_FREQS.length;
const R = EQ_RANGE_DB;

function eqGeometry() {
  const phone = typeof window !== 'undefined' && window.innerWidth <= 600;
  if (!phone) return { cellW: 29, trackH: 112, fadersW: COLS * 29 };
  const avail = Math.min(window.innerWidth, 452) - 56;   // panel inner width minus padding
  const cellW = Math.max(30, Math.floor(avail / COLS));
  const trackH = Math.round(Math.min(window.innerHeight * 0.40, 320));
  return { cellW, trackH, fadersW: COLS * cellW };
}

// 0.5 dB steps — smooth but tidy. `h` is the live track height (real px), so the
// gain mapping is correct whether the faders render at the desktop or sheet size.
const yToGain = (y, h) => {
  const g = R - (y / h) * 2 * R;
  const clamped = Math.max(-R, Math.min(R, g));
  return Math.round(clamped * 2) / 2;
};

// Catmull-Rom → cubic bezier: a smooth path threading the fader thumbs.
function smoothPath(pts) {
  if (pts.length < 2) return '';
  const d = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`);
  }
  return d.join(' ');
}

const fmtDb = (g) => `${g > 0 ? '+' : ''}${g.toFixed(g % 1 === 0 ? 0 : 1)} dB`;

// Trigger icon's offset from screen centre — the morph origin for the popup.
function offsetFromCentre(anchorEl) {
  const r = anchorEl?.getBoundingClientRect?.();
  if (!r || typeof window === 'undefined') return { dx: 0, dy: 0 };
  return {
    dx: Math.round(r.left + r.width / 2 - window.innerWidth / 2),
    dy: Math.round(r.top + r.height / 2 - window.innerHeight / 2),
  };
}

// EQ trigger + popup. Replaces the volume slider in the player surfaces; volume
// now lives inside the popup. `compact` shrinks the trigger for tight bars.
// The popup stays mounted through its collapse animation so closing — whether by
// re-tapping the trigger, clicking outside, or Esc — always plays back into the
// button.
export function EqualizerControl({ player, compact = false }) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const anchorRef = useRef(null);

  if (!player) return null;

  const open = (el) => { anchorRef.current = el; setClosing(false); setMounted(true); };
  const requestClose = () => setClosing(true);
  const finalize = () => { setMounted(false); setClosing(false); };
  const toggle = (el) => { (mounted && !closing) ? requestClose() : open(el); };

  return (
    <>
      <button type="button"
        onClick={(e) => toggle(e.currentTarget)}
        aria-label={mounted && !closing ? 'close equalizer' : 'open equalizer'}
        aria-haspopup="dialog" aria-expanded={mounted && !closing}
        className={`aura-eq__trigger ${compact ? 'aura-eq__trigger--compact' : ''} ${mounted && !closing ? 'is-open' : ''}`}>
        <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2 V14 M8 2 V14 M12 2 V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="4"  cy="10.5" r="2" fill="var(--color-bg)" stroke="currentColor" strokeWidth="1.4"/>
          <circle cx="8"  cy="5.5"  r="2" fill="var(--color-bg)" stroke="currentColor" strokeWidth="1.4"/>
          <circle cx="12" cy="9"    r="2" fill="var(--color-bg)" stroke="currentColor" strokeWidth="1.4"/>
        </svg>
      </button>
      {mounted && (
        <EqPopup player={player} anchorEl={anchorRef.current}
          closing={closing} onRequestClose={requestClose} onFinalized={finalize}/>
      )}
    </>
  );
}

function EqPopup({ player, anchorEl, closing, onRequestClose, onFinalized }) {
  const panelRef = useRef(null);
  const dragRef = useRef(null);            // band index currently dragged (or null)
  const [quality, setQuality] = useAudioQuality();
  const userPresets = useEqUserPresets();
  const [gains, setGains] = useState(() => player.getEqGains());
  const [activeBand, setActiveBand] = useState(null);
  const [volumeActive, setVolumeActive] = useState(false);
  const [opening, setOpening] = useState(true);   // true only while the open morph runs
  // Morph origin (icon offset from centre). Computed synchronously for the first
  // paint (the open morph needs it) and refreshed on resize so the close morph
  // still collapses into the moved icon.
  const [{ dx, dy }, setOffset] = useState(() => offsetFromCentre(anchorEl));
  // Fader geometry, fixed for this open (desktop popup vs phone sheet).
  const geo = useMemo(() => eqGeometry(), []);
  const gainToY = (g) => (1 - (g + R) / (2 * R)) * geo.trackH;
  const bandX = (i) => (i + 0.5) * geo.cellW;

  const closeRef = useRef(onRequestClose); closeRef.current = onRequestClose;

  useEffect(() => {
    const onResize = () => setOffset(offsetFromCentre(anchorEl));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [anchorEl]);

  // Keep gains in sync with the engine (band drags + presets both emit 'eq').
  // Initial value comes from the useState initializer above; this only listens
  // for later changes (incl. another EQ instance).
  useEffect(() => player.on('eq', (g) => setGains(g.slice())), [player]);

  // iOS heads-up (once): tapping the EQ commits the Web Audio tap, which iOS
  // forfeits lock-screen / background playback for. Tell the user before they
  // touch a slider so it isn't a silent surprise. See HtmlAudioPlayer.play().
  useEffect(() => {
    if (!isIOS()) return;
    try {
      if (localStorage.getItem('aura.eq.iosWarned') === '1') return;
      localStorage.setItem('aura.eq.iosWarned', '1');
    } catch { /* localStorage disabled — show it anyway */ }
    toast('on iphone, using the equalizer pauses lock-screen playback for this session.');
  }, []);

  // Centered modal — close on outside pointer / Esc. (The trigger is excluded so
  // a re-tap toggles via EqualizerControl instead of double-firing a close.)
  useEffect(() => {
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || anchorEl?.contains(e.target)) return;
      closeRef.current();
    };
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorEl]);

  const setBand = (i, g) => { dragRef.current = i; player.setEqBand(i, g); };
  const onTrackPointerDown = (i) => (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveBand(i);
    const r = e.currentTarget.getBoundingClientRect();
    setBand(i, yToGain(e.clientY - r.top, r.height));
  };
  const onTrackPointerMove = (i) => (e) => {
    if (dragRef.current !== i) return;
    const r = e.currentTarget.getBoundingClientRect();
    setBand(i, yToGain(e.clientY - r.top, r.height));
  };
  const endDrag = () => { dragRef.current = null; setActiveBand(null); };
  const onBandKey = (i) => (e) => {
    let next = null;
    if (e.key === 'ArrowUp')        next = Math.min(R, gains[i] + 1);
    else if (e.key === 'ArrowDown') next = Math.max(-R, gains[i] - 1);
    else if (e.key === 'Home')      next = -R;
    else if (e.key === 'End')       next = R;
    if (next === null) return;
    e.preventDefault();
    setActiveBand(i);                 // keep readout + highlight on the band being keyed
    player.setEqBand(i, next);
  };

  // Save the live curve as a named preset. Only offered when it's "Custom" (the
  // curve matches no existing preset). Reuses the shared prompt/toast buses.
  const savePreset = async () => {
    const name = await prompt({ title: 'name this preset', placeholder: 'e.g. late night', submitLabel: 'save' });
    if (!name) return;   // prompt returns the trimmed value, or null on cancel/empty
    if (userPresets.length >= MAX_PRESETS) { toast(`preset limit reached (${MAX_PRESETS}).`); return; }
    if (userPresets.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      toast('you already have a preset with that name.'); return;
    }
    saveEqUserPreset(name, player.getEqGains());
    toast('preset saved.');
  };
  const removePreset = async (preset) => {
    if (await confirm({ title: `delete "${preset.name}"?`, danger: true, confirmLabel: 'delete' })) {
      deleteEqUserPreset(preset.id);
      toast('preset deleted.');
    }
  };

  const points = gains.map((g, i) => ({ x: bandX(i), y: gainToY(g) }));
  // The active chip can be a built-in mood preset OR one of the user's saved
  // ones — check both so a saved curve highlights when it's the current sound.
  const activePreset = EQ_PRESETS.find(p => gainsMatch(p.gains, gains))
    ?? userPresets.find(p => gainsMatch(p.gains, gains));
  const readout = activeBand != null ? `${EQ_LABELS[activeBand]} · ${fmtDb(gains[activeBand])}` : 'Equalizer';

  const target = document.querySelector('.aura-responsive-shell') ?? document.body;

  return createPortal(
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Equalizer"
      className={`aura-eq__panel ${closing ? 'is-closing' : 'is-open'}`}
      style={{ '--eq-dx': `${dx}px`, '--eq-dy': `${dy}px` }}
      onClick={(e) => e.stopPropagation()}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        if (closing) onFinalized(); else setOpening(false);   // open morph done → enable faders
      }}>

      <div className="aura-eq__head">
        <MonoLabel className="text-ink-faint" size={10}>{readout}</MonoLabel>
        <button type="button" onClick={onRequestClose} aria-label="close equalizer" className="aura-eq__close">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="aura-eq__presets">
        {EQ_PRESETS.map(p => (
          <button key={p.id} type="button"
            onClick={() => player.setEqGains(p.gains)}
            className={`aura-eq__chip ${activePreset?.id === p.id ? 'is-on' : ''}`}>
            {p.name}
          </button>
        ))}
        {/* The user's own saved curves — load on tap, delete via the × . */}
        {userPresets.map(p => (
          <span key={p.id} className={`aura-eq__chip aura-eq__chip--user ${activePreset?.id === p.id ? 'is-on' : ''}`}>
            <button type="button" className="aura-eq__chip-load" onClick={() => player.setEqGains(p.gains)}>
              {p.name}
            </button>
            <button type="button" className="aura-eq__chip-del" aria-label={`delete ${p.name}`}
              onClick={() => removePreset(p)}>
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          </span>
        ))}
        {/* Custom: appears once the curve matches no preset (user dialled their
            own). Sits next to a save action so they can keep it. */}
        {!activePreset && <span className="aura-eq__chip aura-eq__chip--custom is-on">Custom</span>}
        {!activePreset && userPresets.length < MAX_PRESETS && (
          <button type="button" className="aura-eq__chip aura-eq__chip--save" onClick={savePreset}>
            + Save
          </button>
        )}
      </div>

      {/* Bands gray + blur out while the volume control is being used, so the two
          controls read as distinct. */}
      <div className={`aura-eq__bands ${opening ? 'is-morphing' : ''} ${volumeActive ? 'is-volume-active' : ''}`}>
        <div className="aura-eq__faders" style={{ width: geo.fadersW, height: geo.trackH }}>
          <svg className="aura-eq__curve" viewBox={`0 0 ${geo.fadersW} ${geo.trackH}`} width={geo.fadersW} height={geo.trackH} aria-hidden="true">
            <line x1="0" y1={gainToY(0)} x2={geo.fadersW} y2={gainToY(0)} className="aura-eq__zero"/>
            <path d={`${smoothPath(points)} L ${geo.fadersW} ${geo.trackH} L 0 ${geo.trackH} Z`} className="aura-eq__fill"/>
            <path d={smoothPath(points)} className="aura-eq__line"/>
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={activeBand === i ? 5 : 3.5}
                className={`aura-eq__dot ${activeBand === i ? 'is-active' : ''}`}/>
            ))}
          </svg>
          <div className="aura-eq__cols">
            {EQ_FREQS.map((_, i) => (
              <div key={i}
                className={`aura-eq__col ${activeBand === i ? 'is-active' : ''}`}
                role="slider" tabIndex={0} aria-orientation="vertical"
                aria-label={`${EQ_LABELS[i]} hertz`}
                aria-valuemin={-R} aria-valuemax={R} aria-valuenow={gains[i]}
                onPointerDown={onTrackPointerDown(i)}
                onPointerMove={onTrackPointerMove(i)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onFocus={() => setActiveBand(i)}
                onBlur={() => { if (dragRef.current === null) setActiveBand(null); }}
                onKeyDown={onBandKey(i)}>
                <span className="aura-eq__col-hit"/>
              </div>
            ))}
          </div>
        </div>
        <div className="aura-eq__labels" style={{ width: geo.fadersW }}>
          {EQ_LABELS.map((l, i) => <span key={i} className="aura-eq__label">{l}</span>)}
        </div>
      </div>

      <div className="aura-eq__quality">
        <MonoLabel className="text-ink-faint" size={9}>quality</MonoLabel>
        <div className="aura-eq__quality-pills" role="group" aria-label="audio quality">
          {QUALITIES.map(q => (
            <button key={q.id} type="button"
              onClick={() => setQuality(q.id)}
              aria-pressed={quality === q.id}
              className={`aura-eq__chip ${quality === q.id ? 'is-on' : ''}`}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="aura-eq__volume"
        onPointerEnter={() => setVolumeActive(true)}
        onPointerLeave={() => setVolumeActive(false)}
        onFocusCapture={() => setVolumeActive(true)}
        onBlurCapture={() => setVolumeActive(false)}>
        <VolumeSlider player={player}/>
      </div>
    </div>,
    target,
  );
}

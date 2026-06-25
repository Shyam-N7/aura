// Ambient "aura" backdrop for the onboarding screen — a calm, alive field behind
// the stepper card so a new user feels AURA the moment they arrive. Pure CSS/SVG
// (no WebGL): a warm base wash, drifting radial blooms, a breathing orb halo, a
// few large line-art sketches in the house style (the mood glyphs grown up), and
// a faint grain. Everything is tinted by `--onb-tint` (set on `.aura-onb` from the
// chosen mood), so the whole field warms to the mood the user picks in step 2.
//
// Decorative + inert: aria-hidden, pointer-events:none, no text/roles — so it
// never touches the screen's accessibility tree or interaction. All motion is
// frozen under prefers-reduced-motion (see OnboardingScreen.css).

export function OnboardingBackdrop() {
  return (
    <div className="aura-onb__backdrop" aria-hidden="true">
      <div className="aura-onb__bd-wash"/>

      {/* drifting colour blooms — the soft glow */}
      <div className="aura-onb__bd-bloom aura-onb__bd-bloom--a"/>
      <div className="aura-onb__bd-bloom aura-onb__bd-bloom--b"/>
      <div className="aura-onb__bd-bloom aura-onb__bd-bloom--c"/>

      {/* breathing orb halo behind the card centre (a CSS echo of HeroOrb) */}
      <div className="aura-onb__bd-orb"/>

      {/* line-art sketches — house style: hairline round-cap strokes in currentColor
          (= the tint), very low opacity, drifting slowly. Echo the mood glyphs. */}
      <RingsSketch  className="aura-onb__bd-sketch aura-onb__bd-sketch--rings"/>
      <OrbitSketch  className="aura-onb__bd-sketch aura-onb__bd-sketch--orbit"/>
      <SparkSketch  className="aura-onb__bd-sketch aura-onb__bd-sketch--spark"/>
      <SpiralSketch className="aura-onb__bd-sketch aura-onb__bd-sketch--spiral"/>
      <WaveSketch   className="aura-onb__bd-sketch aura-onb__bd-sketch--wave"/>

      <div className="aura-onb__bd-grain"/>
    </div>
  );
}

// Hairline strokes that stay ~1px no matter how large the sketch renders
// (vector-effect: non-scaling-stroke), matching the delicate line-art house style.
const STROKE = { stroke: 'currentColor', strokeWidth: 1.2, vectorEffect: 'non-scaling-stroke', strokeLinecap: 'round', strokeLinejoin: 'round' };

function RingsSketch({ className }) {  // concentric rings — echoes FocusedIcon / album-art rings
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none">
      <circle cx="60" cy="60" r="54" {...STROKE}/>
      <circle cx="60" cy="60" r="40" {...STROKE}/>
      <circle cx="60" cy="60" r="26" {...STROKE}/>
      <circle cx="60" cy="60" r="12" {...STROKE}/>
      <circle cx="60" cy="60" r="2.5" fill="currentColor"/>
    </svg>
  );
}

function OrbitSketch({ className }) {  // tilted orbit ring with a travelling dot
  return (
    <svg className={className} viewBox="0 0 140 100" fill="none">
      <g transform="rotate(-18 70 50)">
        <ellipse cx="70" cy="50" rx="62" ry="28" {...STROKE}/>
      </g>
      <circle cx="124" cy="36" r="3" fill="currentColor"/>
    </svg>
  );
}

function SparkSketch({ className }) {  // four-point spark — CuriousIcon grown up
  return (
    <svg className={className} viewBox="0 0 80 80" fill="none">
      <path d="M40 6 L44 36 L74 40 L44 44 L40 74 L36 44 L6 40 L36 36 Z" {...STROKE}/>
    </svg>
  );
}

function SpiralSketch({ className }) {  // expanding coil — RememberingIcon grown up
  return (
    <svg className={className} viewBox="0 0 130 120" fill="none">
      <path d="M65 60 a3 3 0 1 1 -6 0 a9 9 0 1 0 18 0 a15 15 0 1 1 -30 0 a21 21 0 1 0 42 0 a27 27 0 1 1 -54 0"
        {...STROKE}/>
    </svg>
  );
}

function WaveSketch({ className }) {  // flowing waveform — the "sound" motif
  return (
    <svg className={className} viewBox="0 0 200 60" fill="none">
      <path d="M0 30 C 25 6, 50 6, 75 30 S 125 54, 150 30 S 200 6, 200 30" {...STROKE}/>
      <path d="M0 44 C 25 24, 50 24, 75 44 S 125 64, 150 44 S 200 24, 200 44" {...STROKE} opacity="0.55"/>
    </svg>
  );
}

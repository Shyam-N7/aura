import './landing-spotlights.css';

// Full-bleed feature band: a text column (eyebrow + serif headline + plain copy)
// next to the live "stage" (a real in-app component). Alternates sides via `flip`.
// The band's `.lp-stage__inner` is faded up + parallax-drifted on scroll by GSAP
// ScrollTrigger (runLandingAnimations in LandingPage.jsx).
export function FeatureBand({ id, eyebrow, title, copy, children, flip = false }) {
  return (
    <section className={`lp-band lp-stage${flip ? ' lp-band--flip' : ''}`} id={id}>
      {/* .lp-stage__inner is the plain flow wrapper runLandingAnimations fades +
          parallax-drifts; the band's own grid lives inside it. */}
      <div className="lp-stage__inner">
        <div className="lp-band__inner">
          <div className="lp-band__text">
            <span className="mono">{eyebrow}</span>
            <h2>{title}</h2>
            {copy && <p className="kicker">{copy}</p>}
          </div>
          <div className="lp-band__stage">{children}</div>
        </div>
      </div>
    </section>
  );
}

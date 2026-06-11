import { useEffect, useState } from 'react';
import { getConsent, setConsent, subscribeConsent } from '../lib/consent';
import './ConsentBanner.css';

// First-visit analytics consent. Shows until the user decides; their choice
// gates whether Vercel Analytics / Speed Insights load (see main.jsx).
export function ConsentBanner({ onPrivacy }) {
  const [consent, setC] = useState(getConsent());
  useEffect(() => subscribeConsent(setC), []);

  if (consent) return null;

  return (
    <div className="aura-consent" role="dialog" aria-label="Privacy choices">
      <p className="aura-consent__text">
        AURA uses privacy-friendly analytics to learn what’s working — nothing loads until you choose.
        {onPrivacy && (
          <> <button type="button" className="aura-consent__link" onClick={onPrivacy}>Privacy</button>.</>
        )}
      </p>
      <div className="aura-consent__actions">
        <button type="button" className="aura-consent__btn" onClick={() => setConsent('denied')}>
          No thanks
        </button>
        <button type="button" className="aura-consent__btn aura-consent__btn--primary" onClick={() => setConsent('granted')}>
          Allow
        </button>
      </div>
    </div>
  );
}

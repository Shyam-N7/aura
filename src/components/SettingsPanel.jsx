import { useEffect, useState } from 'react';
import { logout } from '../lib/auth';
import { confirm } from '../lib/confirm';
import { clearPostAuthPath } from '../lib/routes';
import { exportMyData, deleteMyAccount } from '../api/account';
import { toast } from '../lib/toast';
import { getConsent, setConsent, subscribeConsent } from '../lib/consent';
import { QUALITIES } from '../lib/audioQuality';
import { useAudioQuality } from '../hooks/useAudioQuality';
import { THEMES } from '../data/themes';
import './SettingsPanel.css';

// Inline settings — lives INSIDE the library's settings shelf and expands in
// place with it (no separate screen, no sub-pages). Flat sections, top to
// bottom: appearance → privacy & data → sign out → delete account (last,
// hidden until the shelf is opened).

const THEME_LABELS = {
  dusk:     'warm light',
  midnight: 'dark',
  bloom:    'soft pink',
};

export function SettingsPanel({ t, setTweak }) {
  // Analytics consent is three-state ('granted' | 'denied' | null = undecided);
  // the switch shares the consent bus with ConsentBanner, so deciding here
  // also dismisses the banner for good.
  const [consent, setConsentState] = useState(getConsent());
  useEffect(() => subscribeConsent(setConsentState), []);

  const [quality, setQuality] = useAudioQuality();
  const qualityCaption = QUALITIES.find(q => q.id === quality)?.caption ?? '';

  const handleSignOut = async () => {
    const ok = await confirm({
      title: 'sign out?',
      body: "you'll need to sign in again to get back to your music.",
      confirmLabel: 'sign out',
      cancelLabel: 'stay',
      danger: true,
    });
    if (!ok) return;
    logout();
    // Land the signed-out view on '/' before AppRoot's stash effect runs, and
    // drop any pending post-auth redirect from an earlier bounce.
    try { window.history.pushState(null, '', '/'); } catch { /* ignore */ }
    clearPostAuthPath();
  };

  // GDPR: permanently delete the account (cascades all history) and sign out.
  const handleDelete = async () => {
    const ok = await confirm({
      title: 'delete your account?',
      body: 'this permanently erases your account and all your listening history. it cannot be undone.',
      confirmLabel: 'delete forever',
      cancelLabel: 'keep my account',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMyAccount();
      logout();
      try { window.history.pushState(null, '', '/'); } catch { /* ignore */ }
      clearPostAuthPath();
      toast('your account has been deleted.');
    } catch (err) {
      toast(`couldn't delete — ${err.message}`);
    }
  };

  // GDPR: download everything we hold as a JSON file.
  const handleExport = async () => {
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aura-data-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('your data is downloading.');
    } catch (err) {
      toast(`couldn't export — ${err.message}`);
    }
  };

  // SPA-navigate to a public route by pushing + nudging AppRoot's popstate listener.
  const goPath = (path) => () => {
    try {
      window.history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* ignore */ }
  };

  const consentCaption =
    consent === 'granted' ? 'privacy-friendly analytics is on.'
    : consent === 'denied' ? 'analytics is off.'
    : "you haven't chosen yet — nothing loads until you do.";

  return (
    <div className="aura-set">
      <p className="aura-set__group-label">appearance</p>
      <div className="aura-set__themes">
        {Object.keys(THEMES).map((id) => (
          <button key={id} type="button"
            className={`aura-set__theme ${t.theme === id ? 'is-on' : ''}`}
            aria-pressed={t.theme === id}
            onClick={() => setTweak('theme', id)}>
            <span className="aura-set__theme-chips" aria-hidden="true"
              style={{ background: THEMES[id].bg }}>
              <span style={{ background: THEMES[id].accent }}/>
            </span>
            <span className="aura-set__row-text">
              <span className="aura-set__row-label">{id}</span>
              <span className="aura-set__row-caption">{THEME_LABELS[id]}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="aura-set__group-label">sound</p>
      <div className="aura-set__pills" role="group" aria-label="audio quality">
        {QUALITIES.map((q) => (
          <button key={q.id} type="button"
            className={`aura-set__pill ${quality === q.id ? 'is-on' : ''}`}
            aria-pressed={quality === q.id}
            onClick={() => setQuality(q.id)}>
            {q.label}
          </button>
        ))}
      </div>
      <p className="aura-set__caption">{qualityCaption}</p>

      <p className="aura-set__group-label">privacy & data</p>
      <div className="aura-set__group">
        <button type="button" role="switch" aria-checked={consent === 'granted'}
          className="aura-set__row"
          onClick={() => setConsent(consent === 'granted' ? 'denied' : 'granted')}>
          <span className="aura-set__row-text">
            <span className="aura-set__row-label">analytics</span>
            <span className="aura-set__row-caption">{consentCaption}</span>
          </span>
          <span className={`aura-set__switch ${consent === 'granted' ? 'is-on' : ''}`} aria-hidden="true">
            <span/>
          </span>
        </button>
        <button type="button" className="aura-set__row" onClick={handleExport}>
          <span className="aura-set__row-text">
            <span className="aura-set__row-label">export my data</span>
            <span className="aura-set__row-caption">download a copy of everything aura keeps.</span>
          </span>
        </button>
        <button type="button" className="aura-set__row" onClick={goPath('/privacy')}>
          <span className="aura-set__row-label">privacy policy</span>
        </button>
        <button type="button" className="aura-set__row" onClick={goPath('/terms')}>
          <span className="aura-set__row-label">terms</span>
        </button>
      </div>

      <div className="aura-set__group">
        <button type="button" className="aura-set__row aura-set__row--accent" onClick={handleSignOut}>
          sign out
        </button>
      </div>

      <div className="aura-set__danger-zone">
        <button type="button" className="aura-set__row aura-set__row--danger" onClick={handleDelete}>
          delete my account
        </button>
        <p className="aura-set__caption">permanently erases your account and all listening history.</p>
      </div>
    </div>
  );
}

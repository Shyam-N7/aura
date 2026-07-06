import { useEffect, useState } from 'react';
import { logout, useAuth, enableFamilyMode, disableFamilyMode, updatePreferences, listDevices, revokeDevice, logoutOtherDevices } from '../lib/auth';
import { relTime } from '../lib/time';
import { confirm } from '../lib/confirm';
import { clearPostAuthPath } from '../lib/routes';
import { exportMyData, deleteMyAccount, requestDeleteCode } from '../api/account';
import { toast } from '../lib/toast';
import { getConsent, setConsent, subscribeConsent } from '../lib/consent';
import { QUALITIES } from '../lib/audioQuality';
import { useAudioQuality } from '../hooks/useAudioQuality';
import { getLeveling, setLeveling, levelingAvailable } from '../lib/audioLeveling';
import { listHidden, unhideTrack } from '../api/hidden';
import { getSpokenConfirm, setSpokenConfirm } from '../lib/carVoice';
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

  // Volume leveling — even out loudness across songs (the YouTube model: hot
  // tracks come down via plain element volume). No Web Audio, background-safe.
  // Hidden on iOS, where the browser ignores app volume changes entirely.
  const [leveling, setLevelingState] = useState(getLeveling());
  const toggleLeveling = () => {
    const next = !leveling;
    setLeveling(next);
    setLevelingState(next);
    toast(next ? 'volume leveling on.' : 'volume leveling off.');
  };

  // Spoken confirmations — in hands-free Car Mode, aura says the song name aloud
  // when a voice request resolves so you can keep your eyes on the road. Default on.
  const [spokenConfirm, setSpokenConfirmState] = useState(getSpokenConfirm());
  const toggleSpokenConfirm = () => {
    const next = !spokenConfirm;
    setSpokenConfirm(next);
    setSpokenConfirmState(next);
    toast(next ? 'spoken confirmations on.' : 'spoken confirmations off.');
  };

  // Family mode — a PIN-gated toggle. Off → reveal a "set a PIN" field; on →
  // reveal an "enter your PIN to turn off" field. The switch reads from the live
  // user (enable/disable refresh the session, so this reacts immediately).
  const { user } = useAuth();
  const familyOn = !!user?.familyMode;
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  // Delete-account step-up (mirrors the family-PIN inline form): reveal a password
  // field (accounts with a password) or an emailed 6-digit code (Google-only).
  const hasPassword = user?.hasPassword !== false;   // default to asking for a password if unknown
  const [delOpen, setDelOpen] = useState(false);
  const [delSecret, setDelSecret] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  // Welcome-screen (the "sensing" intro) toggle. Default on for accounts cached
  // before this preference existed. When on, the intro still shows at most once a
  // day and is tap-to-skip — this is the hard on/off.
  const sensingOn = user?.showSensing !== false;
  const [sensingBusy, setSensingBusy] = useState(false);
  const toggleSensing = async () => {
    if (sensingBusy) return;
    setSensingBusy(true);
    try {
      await updatePreferences({ showSensing: !sensingOn });
      toast(sensingOn ? 'welcome screen is off.' : 'welcome screen is on.');
    } catch (err) {
      toast(`couldn't update — ${err.message}`);
    } finally {
      setSensingBusy(false);
    }
  };

  const submitFamily = async (e) => {
    e.preventDefault();
    if (pinBusy) return;
    if (!/^\d{4,6}$/.test(pin)) { toast('enter a 4–6 digit PIN'); return; }
    setPinBusy(true);
    try {
      if (familyOn) { await disableFamilyMode(pin); toast('family mode is off.'); }
      else          { await enableFamilyMode(pin);  toast('family mode is on.'); }
      setPin('');
      setPinOpen(false);
    } catch (err) {
      const left = err.attemptsLeft;
      toast(left != null ? `${err.message} — ${left} left` : err.message);
    } finally {
      setPinBusy(false);
    }
  };

  // Devices: the user's active sessions (this device flagged). Loaded when the
  // settings shelf mounts; pruned locally after a revoke so the list reacts at once.
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState(null);
  useEffect(() => {
    let alive = true;
    listDevices()
      .then(({ sessions, currentId }) => { if (alive) { setDevices(sessions); setCurrentDeviceId(currentId); } })
      .catch(() => { if (alive) setDevicesError(true); })   // distinct from a genuinely-empty list
      .finally(() => { if (alive) setDevicesLoading(false); });
    return () => { alive = false; };
  }, []);

  const removeDevice = async (id) => {
    try {
      await revokeDevice(id);
      setDevices(ds => ds.filter(d => d.id !== id));
      toast('device logged out.');
    } catch (err) { toast(err.message); }
  };

  // Hidden songs — the visible "don't show this again" list (mixes/auto-radio
  // never pick these). Loaded on mount; unhide prunes locally so it reacts at once.
  const [hidden, setHidden] = useState([]);
  const [hiddenLoading, setHiddenLoading] = useState(true);
  const [hiddenError, setHiddenError] = useState(false);
  useEffect(() => {
    let alive = true;
    listHidden()
      .then((h) => { if (alive) setHidden(h); })
      .catch(() => { if (alive) setHiddenError(true); })
      .finally(() => { if (alive) setHiddenLoading(false); });
    return () => { alive = false; };
  }, []);

  const unhideOne = async (id) => {
    try {
      await unhideTrack(id);
      setHidden(hs => hs.filter(h => h.id !== id));
      toast('back in the mix.');
    } catch (err) { toast(err.message); }
  };

  const logOutOthers = async () => {
    const ok = await confirm({
      title: 'log out other devices?',
      body: 'every other signed-in device is logged out. this device stays signed in.',
      confirmLabel: 'log out others',
      cancelLabel: 'cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await logoutOtherDevices();
      setDevices(ds => ds.filter(d => d.id === currentDeviceId));
      toast('other devices logged out.');
    } catch (err) { toast(err.message); }
  };

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
    // drop any pending post-auth redirect from an earlier bounce. replaceState
    // (not push) so the exit-guard's buffer entry is overwritten, not buried.
    try { window.history.replaceState(null, '', '/'); } catch { /* ignore */ }
    clearPostAuthPath();
  };

  // GDPR delete — step-up re-auth. Clean sign-out is also the "already gone" landing.
  const cleanSignOut = (msg) => {
    logout();
    try { window.history.replaceState(null, '', '/'); } catch { /* ignore */ }
    clearPostAuthPath();
    toast(msg);
  };
  const sendDeleteCode = async () => {
    if (delBusy) return;
    setDelBusy(true);
    try {
      await requestDeleteCode();
      setCodeSent(true);
      toast('we emailed you a delete code.');
    } catch (err) {
      toast(err.retryAfterSec ? `wait a moment — ${err.retryAfterSec}s` : `couldn't send a code — ${err.message}`);
    } finally {
      setDelBusy(false);
    }
  };
  const submitDelete = async (e) => {
    e.preventDefault();
    if (delBusy) return;
    const secret = delSecret.trim();
    if (!secret) { toast(hasPassword ? 'enter your password' : 'enter the code'); return; }
    setDelBusy(true);
    try {
      await deleteMyAccount(hasPassword ? { password: secret } : { code: secret });
      cleanSignOut('your account has been deleted.');
    } catch (err) {
      // 404 = already gone → the delete "failing" is the desired end state.
      if (err.status === 404) { cleanSignOut('your account has been deleted.'); return; }
      const left = err.attemptsLeft;
      toast(left != null ? `${err.message} — ${left} left` : err.message);
      setDelSecret('');
    } finally {
      setDelBusy(false);
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
      {levelingAvailable() && <div className="aura-set__group">
        <button type="button" role="switch" aria-checked={leveling}
          className="aura-set__row" onClick={toggleLeveling}>
          <span className="aura-set__row-text">
            <span className="aura-set__row-label">volume leveling</span>
            <span className="aura-set__row-caption">
              {leveling
                ? 'evens out loudness across songs so nothing plays too loud.'
                : 'plays each song at its original loudness.'}
            </span>
          </span>
          <span className={`aura-set__switch ${leveling ? 'is-on' : ''}`} aria-hidden="true"><span/></span>
        </button>
      </div>}
      <div className="aura-set__group">
        <button type="button" role="switch" aria-checked={spokenConfirm}
          className="aura-set__row" onClick={toggleSpokenConfirm}>
          <span className="aura-set__row-text">
            <span className="aura-set__row-label">spoken confirmations</span>
            <span className="aura-set__row-caption">
              {spokenConfirm
                ? 'in car mode, aura says the song name aloud when you ask by voice. it plays over the first moment of the song.'
                : 'voice requests play silently, with on-screen text only.'}
            </span>
          </span>
          <span className={`aura-set__switch ${spokenConfirm ? 'is-on' : ''}`} aria-hidden="true"><span/></span>
        </button>
      </div>

      <p className="aura-set__group-label">made for you</p>
      <div className="aura-set__group">
        {hiddenLoading && <p className="aura-set__caption">loading…</p>}
        {!hiddenLoading && hiddenError && <p className="aura-set__caption">couldn’t load hidden songs — try reopening settings.</p>}
        {!hiddenLoading && !hiddenError && hidden.length === 0 && (
          <p className="aura-set__caption">
            no hidden songs. “don’t show this again” on any mix track lands here.
          </p>
        )}
        {hidden.map((h) => (
          <div key={h.id} className="aura-set__device">
            <span className="aura-set__row-text">
              <span className="aura-set__row-label">{(h.title || '').toLowerCase()}</span>
              <span className="aura-set__row-caption">
                {(h.artist || '').toLowerCase() || 'aura won’t pick this for you'}
              </span>
            </span>
            <button type="button" className="aura-set__device-remove"
              aria-label={`unhide ${h.title}`}
              onClick={() => unhideOne(h.id)}>unhide</button>
          </div>
        ))}
      </div>

      <p className="aura-set__group-label">family mode</p>
      <div className="aura-set__group">
        <button type="button" role="switch" aria-checked={familyOn}
          className="aura-set__row"
          onClick={() => { setPin(''); setPinOpen(o => !o); }}>
          <span className="aura-set__row-text">
            <span className="aura-set__row-label">family mode</span>
            <span className="aura-set__row-caption">
              {familyOn
                ? 'explicit songs are hidden. enter your PIN to turn it off.'
                : 'hide explicit songs and show curated sets. set a PIN to lock it.'}
            </span>
          </span>
          <span className={`aura-set__switch ${familyOn ? 'is-on' : ''}`} aria-hidden="true"><span/></span>
        </button>
        {pinOpen && (
          <form className="aura-set__pinrow" onSubmit={submitFamily}>
            <input className="aura-set__pin" type="password" inputMode="numeric" autoComplete="off"
              maxLength={6} placeholder={familyOn ? 'PIN to turn off' : 'set a 4–6 digit PIN'}
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              aria-label="family mode PIN"/>
            <button type="submit" className="aura-set__pin-btn" disabled={pinBusy}>
              {familyOn ? 'turn off' : 'turn on'}
            </button>
          </form>
        )}
      </div>

      <p className="aura-set__group-label">welcome screen</p>
      <div className="aura-set__group">
        <button type="button" role="switch" aria-checked={sensingOn}
          className="aura-set__row" disabled={sensingBusy} onClick={toggleSensing}>
          <span className="aura-set__row-text">
            <span className="aura-set__row-label">welcome screen</span>
            <span className="aura-set__row-caption">
              {sensingOn
                ? 'a short intro reads your mood when you open aura. shows once a day — tap it to skip.'
                : 'skipped — you go straight to your home.'}
            </span>
          </span>
          <span className={`aura-set__switch ${sensingOn ? 'is-on' : ''}`} aria-hidden="true"><span/></span>
        </button>
      </div>

      <p className="aura-set__group-label">your devices</p>
      <div className="aura-set__group">
        {devicesLoading && <p className="aura-set__caption">loading…</p>}
        {!devicesLoading && devicesError && <p className="aura-set__caption">couldn’t load your devices — try reopening settings.</p>}
        {!devicesLoading && !devicesError && devices.length === 0 && (
          <p className="aura-set__caption">
            {currentDeviceId
              ? 'no other devices.'
              : 'sign out and back in to manage this device here.'}
          </p>
        )}
        {devices.map((d) => (
          <div key={d.id} className="aura-set__device">
            <span className="aura-set__row-text">
              <span className="aura-set__row-label">
                {d.deviceLabel || 'Unknown device'}{d.id === currentDeviceId ? ' · this device' : ''}
              </span>
              <span className="aura-set__row-caption">
                {[d.city, d.country].filter(Boolean).join(', ') || 'location unknown'} · active {relTime(d.lastSeenAt)}
              </span>
            </span>
            {d.id !== currentDeviceId && (
              <button type="button" className="aura-set__device-remove"
                aria-label={`log out ${d.deviceLabel || 'unknown device'}`}
                onClick={() => removeDevice(d.id)}>log out</button>
            )}
          </div>
        ))}
        {devices.length > 1 && (
          <button type="button" className="aura-set__row aura-set__row--accent" onClick={logOutOthers}>
            log out everywhere else
          </button>
        )}
      </div>

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
        <button type="button" className="aura-set__row aura-set__row--danger"
          onClick={() => { setDelSecret(''); setCodeSent(false); setDelOpen(o => !o); }}>
          delete my account
        </button>
        <p className="aura-set__caption">permanently erases your account and all listening history. it can’t be undone.</p>
        {delOpen && (hasPassword ? (
          <form className="aura-set__pinrow" onSubmit={submitDelete}>
            <input className="aura-set__pin" type="password" autoComplete="current-password"
              placeholder="your password" value={delSecret}
              onChange={(e) => setDelSecret(e.target.value)} aria-label="password to delete account"/>
            <button type="submit" className="aura-set__pin-btn" disabled={delBusy}>delete forever</button>
          </form>
        ) : !codeSent ? (
          <button type="button" className="aura-set__row aura-set__row--accent" disabled={delBusy} onClick={sendDeleteCode}>
            email me a delete code
          </button>
        ) : (
          <form className="aura-set__pinrow" onSubmit={submitDelete}>
            <input className="aura-set__pin" type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} placeholder="6-digit code" value={delSecret}
              onChange={(e) => setDelSecret(e.target.value.replace(/\D/g, ''))} aria-label="delete code"/>
            <button type="submit" className="aura-set__pin-btn" disabled={delBusy}>delete forever</button>
          </form>
        ))}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { signup, login, verifyOtp, resendOtp, requestReset, verifyResetCode, resetPassword } from '../lib/auth';
import { toast } from '../lib/toast';
import { AuraMark } from '../components/primitives/AuraMark';
import './AuthPage.css';

/* ── Password strength scorer (0-4) — mirrors the reference IIFE ──────── */
function scorePassword(v) {
  let s = 0;
  if (v.length >= 6) s++;
  if (v.length >= 10) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v) || /[^\w]/.test(v)) s++;
  return s;
}
const STRENGTH_LABELS = [
  'strength · gentle',
  'strength · weak',
  'strength · weak',
  'strength · good',
  'strength · strong',
];

/* ── Email validation ────────────────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ── Dev-only UI flow trace (stripped from production builds) ─────────── */
const trace = (...a) => { if (import.meta.env.DEV) console.log('[auth-ui]', ...a); };

// "— N attempts left" suffix for a wrong-code error (server returns attemptsLeft).
const attemptsSuffix = (n) => (Number.isFinite(n) ? ` — ${n} attempt${n === 1 ? '' : 's'} left` : '');

/* ── Inline SVGs from the reference (icons tint via currentColor) ─────── */
function BackArrowSvg() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M8 1 L3 5 L8 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SubmitArrowSvg() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
      <path d="M1 5 H13 M9 1 L13 5 L9 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AppleSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <path d="M13.6 9.5c0-2.25 1.8-3.33 1.89-3.39-1.03-1.5-2.6-1.71-3.16-1.73-1.34-.14-2.62.79-3.3.79-.69 0-1.74-.77-2.86-.74C4.61 4.45 3.16 5.33 2.4 6.78c-1.55 2.7-.4 6.7 1.13 8.9.74 1.07 1.62 2.27 2.78 2.23 1.12-.05 1.54-.72 2.89-.72s1.74.72 2.92.7c1.21-.02 1.97-1.09 2.71-2.17.86-1.24 1.21-2.45 1.23-2.5-.03-.01-2.36-.91-2.46-3.72zM11.34 2.97c.62-.75 1.04-1.79.93-2.84-.9.04-1.99.6-2.63 1.34-.57.66-1.07 1.72-.94 2.74 1 .08 2.03-.51 2.64-1.24z" />
    </svg>
  );
}
function SpotifySvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill="#1DB954" />
      <path d="M12.6 12.7c-.16.27-.5.36-.77.2-2.11-1.29-4.77-1.58-7.9-.87-.31.07-.62-.13-.69-.43-.07-.31.12-.62.43-.69 3.44-.78 6.38-.45 8.74.98.27.16.36.5.2.77zm.96-2.13c-.2.33-.63.43-.95.23-2.42-1.49-6.1-1.92-8.96-1.05-.37.11-.77-.1-.88-.47-.11-.37.1-.77.47-.88 3.27-.99 7.32-.51 10.09 1.21.32.2.43.63.23.96zm.08-2.21C10.74 6.65 6.04 6.5 3.27 7.34c-.45.13-.92-.12-1.05-.57-.13-.45.12-.92.57-1.05 3.18-.96 8.36-.78 11.65 1.17.4.24.53.76.29 1.16-.24.4-.76.53-1.16.29z" fill="#fff" />
    </svg>
  );
}
function GoogleSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  AuthPage — step machine: form → otp (signup verify) / forgot (reset)  */
/* ══════════════════════════════════════════════════════════════════════ */
export function AuthPage({ initialMode = 'signin', onAuthed, onBack }) {
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'signin');
  // 'form' = sign in / sign up; 'otp' = enter signup code; 'forgot-request' =
  // enter email; 'forgot-code' = enter reset code; 'forgot-newpw' = set password.
  const [step, setStep] = useState('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  // Social sign-in is not live yet — clicking a provider shows a note above the
  // buttons instead of starting an auth flow. Auto-clears after a few seconds.
  const [socialNote, setSocialNote] = useState('');
  const socialNoteTimer = useRef(null);
  useEffect(() => () => clearTimeout(socialNoteTimer.current), []);
  const isSignup = mode === 'signup';
  const pwScore = scorePassword(password);

  /* ── Resend cooldown countdown ──────────────────────────────────────── */
  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const id = setInterval(() => setResendCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  /* ── Mode toggle — syncs the URL query like the reference IIFE ──────── */
  const switchMode = useCallback((next) => {
    setMode(next);
    setStep('form');
    setOtpCode('');
    setNewPassword('');
    setErrors({});
    setFormError('');
    if (next === 'signup') {
      window.history.replaceState(null, '', '?mode=signup');
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const backToForm = useCallback(() => {
    setStep('form');
    setOtpCode('');
    setNewPassword('');
    setErrors({});
    setFormError('');
  }, []);

  /* ── Validation (form step) ─────────────────────────────────────────── */
  const validate = useCallback(() => {
    const e = {};
    if (isSignup && !name.trim()) e.name = 'your name, please.';
    if (!email.trim()) e.email = 'an email is needed.';
    else if (!EMAIL_RE.test(email.trim())) e.email = 'that email looks off.';
    if (!password) e.password = 'a password is needed.';
    else if (password.length < 6) e.password = 'at least six characters.';
    return e;
  }, [isSignup, name, email, password]);

  // Advance to the OTP step (shared by signup + login-of-unverified).
  const goToOtp = useCallback((addr) => {
    setPendingEmail(addr);
    setStep('otp');
    setOtpCode('');
    setErrors({});
    setFormError('');
    setResendCooldown(60);
  }, []);

  /* ── Submit (sign in / sign up) ─────────────────────────────────────── */
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setFormError('');
    const v = validate();
    if (Object.keys(v).length) { setErrors(v); return; }
    setErrors({});
    setPending(true);
    try {
      if (isSignup) {
        const r = await signup({ email: email.trim(), name: name.trim(), password });
        if (r?.pendingVerification) { goToOtp(r.email); return; }
        onAuthed?.(r);
      } else {
        const r = await login({ email: email.trim(), password });
        if (r?.pendingVerification) { goToOtp(r.email); return; }
        onAuthed?.(r);
      }
    } catch (err) {
      const msg = err?.message || 'something went wrong.';
      toast(msg);
      setFormError(msg);
    } finally {
      setPending(false);
    }
  }, [validate, isSignup, email, name, password, onAuthed, goToOtp]);

  /* ── Verify signup code ─────────────────────────────────────────────── */
  const handleVerify = useCallback(async (e) => {
    e.preventDefault();
    if (otpCode.length !== 6) return;
    setFormError('');
    setPending(true);
    try {
      const user = await verifyOtp({ email: pendingEmail, code: otpCode });
      onAuthed?.(user);
    } catch (err) {
      setFormError((err?.message || 'verification failed.') + attemptsSuffix(err?.attemptsLeft));
      // Stale/locked code → let them resend right away.
      if (['expired', 'no_code', 'locked', 'signup_expired'].includes(err?.code)) setResendCooldown(0);
    } finally {
      setPending(false);
    }
  }, [otpCode, pendingEmail, onAuthed]);

  /* ── Resend code (signup OTP or reset code, per step) ───────────────── */
  const handleResendCode = useCallback(async () => {
    if (resendCooldown > 0 || !pendingEmail) return;
    setFormError('');
    trace('resend code →', pendingEmail, `(step: ${step})`);
    const isReset = step === 'forgot-code' || step === 'forgot-newpw';
    try {
      if (isReset) await requestReset(pendingEmail);
      else await resendOtp(pendingEmail);
      setResendCooldown(60);
      // A new code invalidates the old one — send them back to enter the fresh code.
      if (isReset) { setStep('forgot-code'); setOtpCode(''); }
      toast('code sent.');
    } catch (err) {
      if (err?.code === 'cooldown' && err.retryAfterSec) setResendCooldown(err.retryAfterSec);
      else { const m = err?.message || 'could not resend code.'; setFormError(m); toast(m); }
    }
  }, [resendCooldown, pendingEmail, step]);

  /* ── Forgot password — request a code ───────────────────────────────── */
  const handleForgotRequest = useCallback(async (e) => {
    e.preventDefault();
    setFormError('');
    const addr = email.trim();
    if (!addr || !EMAIL_RE.test(addr)) { setErrors({ email: 'that email looks off.' }); return; }
    setErrors({});
    setPending(true);
    trace('forgot-request →', addr);
    try {
      await requestReset(addr);
      trace('code requested → step: forgot-code');
      setPendingEmail(addr);
      setStep('forgot-code');
      setOtpCode('');
      setNewPassword('');
      setResendCooldown(60);
    } catch (err) {
      if (err?.code === 'cooldown' && err.retryAfterSec) {
        // A code was sent recently — still advance to the code step.
        trace('cooldown active → step: forgot-code, retryAfter', err.retryAfterSec);
        setPendingEmail(addr);
        setStep('forgot-code');
        setOtpCode('');
        setNewPassword('');
        setResendCooldown(err.retryAfterSec);
      } else {
        trace('forgot-request failed:', err?.message);
        const m = err?.message || 'could not send code.';
        setFormError(m);
        toast(m);
      }
    } finally {
      setPending(false);
    }
  }, [email]);

  /* ── Reset password — step 1: verify code, then step 2: set password ──── */
  // Step 1: verify the code without consuming it, then reveal the password step.
  const handleVerifyResetCode = useCallback(async (e) => {
    e.preventDefault();
    setFormError('');
    if (otpCode.length !== 6) { setFormError('enter the 6-digit code.'); return; }
    setPending(true);
    trace('verify reset code →', pendingEmail, `(code len ${otpCode.length})`);
    try {
      await verifyResetCode({ email: pendingEmail, code: otpCode });
      trace('code ok → step: forgot-newpw');
      setNewPassword('');
      setErrors({});
      setStep('forgot-newpw');
    } catch (err) {
      trace('code rejected:', err?.code || err?.message);
      setFormError((err?.message || 'that code isn’t right.') + attemptsSuffix(err?.attemptsLeft));
      // Stale/locked code → let them resend right away.
      if (['expired', 'no_code', 'locked'].includes(err?.code)) setResendCooldown(0);
    } finally {
      setPending(false);
    }
  }, [otpCode, pendingEmail]);

  // Step 2: set the new password (server re-verifies the code, then consumes it).
  const handleResetPassword = useCallback(async (e) => {
    e.preventDefault();
    setFormError('');
    if (newPassword.length < 6) { setErrors({ password: 'at least six characters.' }); return; }
    setErrors({});
    setPending(true);
    trace('reset submit →', pendingEmail);
    try {
      await resetPassword({ email: pendingEmail, code: otpCode, password: newPassword });
      trace('reset ok → re-login');
      switchMode('signin');     // back to the sign-in form (resets step + fields)
      setEmail(pendingEmail);   // prefill their email
      setPassword('');          // fresh password entry
      setFormError('password updated — sign in with your new password.');
    } catch (err) {
      trace('reset failed:', err?.code || err?.message);
      // If the code went stale between steps, bounce back to the code step.
      if (['expired', 'no_code', 'locked', 'mismatch', 'bad_format'].includes(err?.code)) {
        setFormError((err?.message || 'that code is no longer valid.') + attemptsSuffix(err?.attemptsLeft));
        setStep('forgot-code');
        if (['expired', 'no_code', 'locked'].includes(err?.code)) setResendCooldown(0);
      } else {
        setFormError(err?.message || 'reset failed.');
      }
    } finally {
      setPending(false);
    }
  }, [otpCode, newPassword, pendingEmail, switchMode]);

  /* ── Social handlers — providers aren't live yet; a "coming soon" bubble
        pops above the tapped button instead of starting an auth flow. ── */
  const showSocialNote = useCallback((provider) => {
    setSocialNote(provider);
    clearTimeout(socialNoteTimer.current);
    socialNoteTimer.current = setTimeout(() => setSocialNote(''), 3000);
  }, []);
  const handleApple   = useCallback(() => showSocialNote('apple'),   [showSocialNote]);
  const handleSpotify = useCallback(() => showSocialNote('spotify'), [showSocialNote]);
  const handleGoogle  = useCallback(() => showSocialNote('google'),  [showSocialNote]);

  // Top-right back: within a sub-step return to the form; otherwise leave.
  const handleBack = useCallback(() => {
    if (step !== 'form') { backToForm(); return; }
    onBack?.();
  }, [step, backToForm, onBack]);

  const resendLine = (
    <div className="form-foot">
      {resendCooldown > 0
        ? <span>Resend code in {resendCooldown}s</span>
        : <span>Didn&apos;t get it?{' '}<a href="#" onClick={(e) => { e.preventDefault(); handleResendCode(); }}>Resend code.</a></span>}
    </div>
  );

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="aura-auth-page">
      {/* Back link (top-right) — also steps back through the OTP/reset flow. */}
      <button type="button" className="auth-back-link" onClick={handleBack}>
        <BackArrowSvg />
        Back
      </button>

      <div className="auth-page">
        {/* One centered glass card on the themed backdrop (no two-panel split). */}
        <main className="form-side">
          <div className="form-wrap">
            <div className="auth-card-brand" aria-hidden="true"><AuraMark size={30} /></div>
            {/* ──────────── Sign in / sign up ──────────── */}
            {step === 'form' && (
              <>
                <header className="form-head">
                  <span className="mono">
                    {isSignup ? 'create account · new' : 'sign in · returning'}
                  </span>
                  <h2>
                    {isSignup ? <>begin <em>listening.</em></> : <>welcome <em>back.</em></>}
                  </h2>
                  <p className="sub">
                    {isSignup
                      ? 'Two minutes of setup. No survey. AURA starts learning from your first song.'
                      : 'Sign in and AURA picks up right where you left off — your journal, your queues, and every song it remembers.'}
                  </p>
                </header>

                {/* Social providers aren't live yet — tapping one pops a
                    "coming soon" speech bubble above that button (role=status
                    announces it without moving focus). The bubble suppresses
                    that button's hover name-tooltip while visible. */}
                <div className="social-row">
                  <button
                    type="button"
                    className={`social-btn social-btn--apple ${socialNote === 'apple' ? 'social-btn--noted' : ''}`}
                    onClick={handleApple}
                    aria-label="Continue with Apple"
                    aria-describedby={socialNote === 'apple' ? 'social-tip' : undefined}
                    data-label="coming soon"
                  >
                    {socialNote === 'apple' && <span id="social-tip" className="social-tip" role="status">coming soon</span>}
                    <AppleSvg />
                  </button>
                  <button
                    type="button"
                    className={`social-btn social-btn--spotify ${socialNote === 'spotify' ? 'social-btn--noted' : ''}`}
                    onClick={handleSpotify}
                    aria-label="Continue with Spotify"
                    aria-describedby={socialNote === 'spotify' ? 'social-tip' : undefined}
                    data-label="coming soon"
                  >
                    {socialNote === 'spotify' && <span id="social-tip" className="social-tip" role="status">coming soon</span>}
                    <SpotifySvg />
                  </button>
                  <button
                    type="button"
                    className={`social-btn social-btn--google ${socialNote === 'google' ? 'social-btn--noted' : ''}`}
                    onClick={handleGoogle}
                    aria-label="Continue with Google"
                    aria-describedby={socialNote === 'google' ? 'social-tip' : undefined}
                    data-label="coming soon"
                  >
                    {socialNote === 'google' && <span id="social-tip" className="social-tip" role="status">coming soon</span>}
                    <GoogleSvg />
                  </button>
                </div>

                <div className="divider"><span>or with email</span></div>

                <form onSubmit={handleSubmit} noValidate>
                  {isSignup && (
                    <div className="field">
                      <label htmlFor="auth-name">Name</label>
                      <input
                        id="auth-name"
                        name="name"
                        type="text"
                        placeholder="What's your name?"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      {errors.name && <span className="field-error">{errors.name}</span>}
                    </div>
                  )}

                  <div className="field">
                    <label htmlFor="auth-email">Email</label>
                    <input
                      id="auth-email"
                      name="email"
                      type="email"
                      placeholder="you@somewhere.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    {errors.email && <span className="field-error">{errors.email}</span>}
                  </div>

                  <div className="field">
                    <div className="field-row">
                      <label htmlFor="auth-password">Password</label>
                      {!isSignup && (
                        <a href="#" onClick={(e) => { e.preventDefault(); setErrors({}); setFormError(''); setStep('forgot-request'); }}>
                          Forgot?
                        </a>
                      )}
                    </div>
                    <input
                      id="auth-password"
                      name="password"
                      type="password"
                      placeholder="••••••••"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    {errors.password && <span className="field-error">{errors.password}</span>}

                    {isSignup && (
                      <div className={`strength show s${pwScore}`}>
                        <div className="bar"><i /><i /><i /><i /></div>
                        <span className="label">{STRENGTH_LABELS[pwScore]}</span>
                      </div>
                    )}
                  </div>

                  {formError && <p className="form-error">{formError}</p>}

                  <button className="auth-submit" type="submit" disabled={pending}>
                    <span>
                      {pending ? 'Setting up…' : isSignup ? 'Create account' : 'Sign in'}
                    </span>
                    <SubmitArrowSvg />
                  </button>
                </form>

                <div className="form-foot">
                  {isSignup ? (
                    <span>
                      Have an account?{' '}
                      <a href="#" onClick={(e) => { e.preventDefault(); switchMode('signin'); }}>
                        Sign in instead.
                      </a>
                    </span>
                  ) : (
                    <span>
                      New to aura?{' '}
                      <a href="#" onClick={(e) => { e.preventDefault(); switchMode('signup'); }}>
                        Create an account.
                      </a>
                    </span>
                  )}
                </div>

                <div className="privacy">
                  By continuing, you agree to our<br />
                  <a href="#" onClick={(e) => e.preventDefault()}>Terms</a> ·{' '}
                  <a href="#" onClick={(e) => e.preventDefault()}>Privacy</a> · your journal stays yours, always.
                </div>
              </>
            )}

            {/* ──────────── Verify signup code ──────────── */}
            {step === 'otp' && (
              <>
                <header className="form-head">
                  <span className="mono">verify · check your inbox</span>
                  <h2>almost <em>there.</em></h2>
                  <p className="sub">
                    Enter the 6-digit code we sent to{' '}
                    <span style={{ color: 'var(--ink)' }}>{pendingEmail}</span>.
                  </p>
                </header>

                <form onSubmit={handleVerify} noValidate>
                  <div className="field">
                    <label htmlFor="auth-otp">Verification code</label>
                    <input
                      id="auth-otp"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="••••••"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      style={{ letterSpacing: '0.3em', textAlign: 'center' }}
                    />
                  </div>

                  {formError && <p className="form-error">{formError}</p>}

                  <button className="auth-submit" type="submit" disabled={pending || otpCode.length !== 6}>
                    <span>{pending ? 'Verifying…' : 'Verify'}</span>
                    <SubmitArrowSvg />
                  </button>
                </form>

                {resendLine}

                <div className="form-foot">
                  <a href="#" onClick={(e) => { e.preventDefault(); backToForm(); }}>Wrong email? Go back.</a>
                </div>
              </>
            )}

            {/* ──────────── Forgot — request a code ──────────── */}
            {step === 'forgot-request' && (
              <>
                <header className="form-head">
                  <span className="mono">reset · forgot password</span>
                  <h2>reset your <em>password.</em></h2>
                  <p className="sub">Enter your email. If it&apos;s registered, we&apos;ll send a 6-digit reset code.</p>
                </header>

                <form onSubmit={handleForgotRequest} noValidate>
                  <div className="field">
                    <label htmlFor="forgot-email">Email</label>
                    <input
                      id="forgot-email"
                      name="email"
                      type="email"
                      placeholder="you@somewhere.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    {errors.email && <span className="field-error">{errors.email}</span>}
                  </div>

                  {formError && <p className="form-error">{formError}</p>}

                  <button className="auth-submit" type="submit" disabled={pending}>
                    <span>{pending ? 'Sending…' : 'Send reset code'}</span>
                    <SubmitArrowSvg />
                  </button>
                </form>

                <div className="form-foot">
                  <a href="#" onClick={(e) => { e.preventDefault(); backToForm(); }}>Back to sign in.</a>
                </div>
              </>
            )}

            {/* ──────────── Forgot — step 1: enter the code ──────────── */}
            {step === 'forgot-code' && (
              <>
                <header className="form-head">
                  <span className="mono">reset · check your inbox</span>
                  <h2>enter your <em>code.</em></h2>
                  <p className="sub">
                    If an account exists for{' '}
                    <span style={{ color: 'var(--ink)' }}>{pendingEmail}</span>, we&apos;ve sent a 6-digit code. Enter it to continue.
                  </p>
                </header>

                <form onSubmit={handleVerifyResetCode} noValidate>
                  <div className="field">
                    <label htmlFor="reset-otp">Reset code</label>
                    <input
                      id="reset-otp"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="••••••"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      style={{ letterSpacing: '0.3em', textAlign: 'center' }}
                    />
                  </div>

                  {formError && <p className="form-error">{formError}</p>}

                  <button className="auth-submit" type="submit" disabled={pending || otpCode.length !== 6}>
                    <span>{pending ? 'Checking…' : 'Continue'}</span>
                    <SubmitArrowSvg />
                  </button>
                </form>

                {resendLine}

                <div className="form-foot">
                  <a href="#" onClick={(e) => { e.preventDefault(); backToForm(); }}>Back to sign in.</a>
                </div>
              </>
            )}

            {/* ──────────── Forgot — step 2: set new password ──────────── */}
            {step === 'forgot-newpw' && (
              <>
                <header className="form-head">
                  <span className="mono">reset · new password</span>
                  <h2>set a new <em>password.</em></h2>
                  <p className="sub">Your code checked out. Choose a new password for your account.</p>
                </header>

                <form onSubmit={handleResetPassword} noValidate>
                  <div className="field">
                    <label htmlFor="reset-pw">New password</label>
                    <input
                      id="reset-pw"
                      name="password"
                      type="password"
                      placeholder="••••••••"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    {errors.password && <span className="field-error">{errors.password}</span>}

                    <div className={`strength show s${scorePassword(newPassword)}`}>
                      <div className="bar"><i /><i /><i /><i /></div>
                      <span className="label">{STRENGTH_LABELS[scorePassword(newPassword)]}</span>
                    </div>
                  </div>

                  {formError && <p className="form-error">{formError}</p>}

                  <button className="auth-submit" type="submit" disabled={pending || newPassword.length < 6}>
                    <span>{pending ? 'Resetting…' : 'Reset password'}</span>
                    <SubmitArrowSvg />
                  </button>
                </form>

                <div className="form-foot">
                  <a href="#" onClick={(e) => { e.preventDefault(); setFormError(''); setOtpCode(''); setStep('forgot-code'); }}>Re-enter code.</a>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

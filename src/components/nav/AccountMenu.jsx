import { useState, useEffect, useRef, useId } from 'react';
import { useAuth, logout } from '../../lib/auth';
import { confirm } from '../../lib/confirm';
import { clearPostAuthPath } from '../../lib/routes';
import { exportMyData, deleteMyAccount } from '../../api/account';
import { toast } from '../../lib/toast';
import './AccountMenu.css';

// Account control for the nav chrome: an avatar (the user's initial) that opens
// a popover with name + email + Sign out. Self-sources the signed-in user via
// the useAuth() singleton, so it needs no props beyond placement — drop it into
// any nav surface. Sign-out is confirm()-gated, then logout() flips AppRoot back
// to the landing view.
//   placement: 'up'   → popover opens above (desktop rail footer)
//              'down' → popover opens below, right-aligned (top bars)
//   collapsed: avatar-only, centered (the 72px collapsed rail)
export function AccountMenu({ placement = 'down', collapsed = false }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const signoutRef = useRef(null);
  const popId = useId();

  // Close on outside click / Escape (mirrors VolumeSlider.jsx's pattern).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector('.aura-account__avatar')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // While open: lift the host nav surface above the floating mini-player (z32)
  // and sleep orb (z33) — the popover lives inside the nav's own z-30 stacking
  // context, so its z-index alone can't out-paint those page-level siblings.
  // Also move focus to the action so keyboard users land on it. Reverts on close.
  useEffect(() => {
    if (!open) return undefined;
    const nav = rootRef.current?.closest('.aura-nav-rail, .aura-top-nav, .aura-mobile-top');
    nav?.classList.add('aura-account-open');
    signoutRef.current?.focus();
    return () => nav?.classList.remove('aura-account-open');
  }, [open]);

  // Guard the one frame between logout() clearing _user and AppRoot unmounting us.
  if (!user) return null;

  const name = (user.name && user.name.trim()) || user.email || 'your account';
  const email = user.email || '';
  const initial = (name[0] || '?').toUpperCase();

  const handleSignOut = async () => {
    setOpen(false);
    const ok = await confirm({
      title: 'sign out?',
      body: "you'll need to sign in again to get back to your music.",
      confirmLabel: 'sign out',
      cancelLabel: 'stay',
      danger: true,
    });
    if (!ok) return;
    logout();
    // Land the signed-out view on '/' (synchronously, before AppRoot's stash
    // effect runs — so the deep path the user was on is never re-stashed), and
    // drop any pending post-auth redirect from an earlier bounce.
    try { window.history.pushState(null, '', '/'); } catch { /* ignore */ }
    clearPostAuthPath();
  };

  // SPA-navigate to a public route by pushing + nudging AppRoot's popstate listener.
  const goPath = (path) => () => {
    setOpen(false);
    try {
      window.history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* ignore */ }
  };

  // GDPR: download everything we hold as a JSON file.
  const handleExport = async () => {
    setOpen(false);
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

  // GDPR: permanently delete the account (cascades all history) and sign out.
  const handleDelete = async () => {
    setOpen(false);
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

  return (
    <div ref={rootRef} className={`aura-account aura-account--${placement} ${collapsed ? 'aura-account--collapsed' : ''}`}>
      <button
        type="button"
        className="aura-account__avatar"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`account · ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        {initial}
      </button>

      {open && (
        <div id={popId} className="aura-account__popover" role="group" aria-label="account">
          <div className="aura-account__id">
            <span className="aura-account__id-avatar" aria-hidden="true">{initial}</span>
            <span className="aura-account__id-text">
              <span className="aura-account__id-name">{name}</span>
              {email && <span className="aura-account__id-email">{email}</span>}
            </span>
          </div>
          <div className="aura-account__divider" />
          <button type="button" className="aura-account__item" onClick={goPath('/privacy')}>privacy</button>
          <button type="button" className="aura-account__item" onClick={goPath('/terms')}>terms</button>
          <button type="button" className="aura-account__item" onClick={handleExport}>export my data</button>
          <div className="aura-account__divider" />
          <button ref={signoutRef} type="button" className="aura-account__signout" onClick={handleSignOut}>
            sign out
          </button>
          <button type="button" className="aura-account__item aura-account__item--danger" onClick={handleDelete}>
            delete my account
          </button>
        </div>
      )}
    </div>
  );
}

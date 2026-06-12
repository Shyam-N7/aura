import { useAuth } from '../../lib/auth';
import './ProfileButton.css';

// The single profile entry point: an avatar that NAVIGATES (profile and
// library are one identity — tapping yourself opens your library) instead of
// the old AccountMenu popover. Sign out / export / delete / legal moved into
// the Settings screen, reached via the gear in the library header.
//   variant 'avatar' → round initial button (top bars)
//   variant 'row'    → avatar + name/email identity block (nav-rail footer);
//                      collapsed → centered avatar only
export function ProfileButton({ onClick, variant = 'avatar', collapsed = false }) {
  const { user } = useAuth();
  // Guard the one frame between logout() clearing _user and AppRoot unmounting us.
  if (!user) return null;

  const name = (user.name && user.name.trim()) || user.email || 'you';
  const email = user.email || '';
  const initial = (name[0] || '?').toUpperCase();

  if (variant === 'row') {
    return (
      <button type="button" onClick={onClick} title={collapsed ? name : undefined}
        aria-label={`your library · ${name}`}
        className={`aura-profile-row ${collapsed ? 'aura-profile-row--collapsed' : ''}`}>
        <span className="aura-profile__avatar" aria-hidden="true">{initial}</span>
        {!collapsed && (
          <span className="aura-profile-row__text">
            <span className="aura-profile-row__name">{name}</span>
            {email && <span className="aura-profile-row__email">{email}</span>}
          </span>
        )}
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-label={`your library · ${name}`}
      className="aura-profile__avatar">
      {initial}
    </button>
  );
}

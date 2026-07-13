import './Avatar.css';

// Shared identity avatar — a profile photo when the user has one, else the
// initial-letter monogram (the app's long-standing fallback). `user` is any
// object with { name, avatarUrl }.
export function Avatar({ user, size = 28, className = '' }) {
  const initial = ((user?.name ?? '').trim()[0] ?? '·').toLowerCase();
  const style = { width: size, height: size };
  return user?.avatarUrl
    ? <img src={user.avatarUrl} alt="" loading="lazy"
        className={`aura-avatar aura-avatar--img ${className}`} style={style}/>
    : <span aria-hidden="true"
        className={`aura-avatar aura-avatar--initial ${className}`}
        style={{ ...style, fontSize: Math.round(size * 0.46) }}>{initial}</span>;
}

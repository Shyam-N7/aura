import './CrumbBack.css';

// Shared back-crumb pill — used across the desktop screen tops.
export function CrumbBack({ onClick, label = 'back' }) {
  return (
    <button onClick={onClick} className="aura-crumb-back">
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M8 1 L3 5 L8 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
      {label}
    </button>
  );
}

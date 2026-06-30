import './UpdatePrompt.css';

// Post-update confirmation toast. Updates now apply themselves at a safe moment
// (skip-waiting + reload, never mid-song), so this is no longer an action prompt —
// it just confirms, after the reload, that the app refreshed to the latest build,
// then self-dismisses. Sits above the mobile chrome; one glass pill matched to the
// app's recipe.
export function UpdatePrompt({ onDismiss }) {
  return (
    <div className="aura-update" role="status" aria-live="polite">
      <span className="aura-update__dot" aria-hidden="true" />
      <span className="aura-update__text">updated to the latest version</span>
      <button type="button" className="aura-update__x" onClick={onDismiss} aria-label="Dismiss">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path d="M2 2 L9 9 M9 2 L2 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

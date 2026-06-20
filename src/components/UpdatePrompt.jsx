import './UpdatePrompt.css';

// Persistent "new version ready" snackbar. registerType:'prompt' keeps the old
// bundle running until the user acts, so this stays put (no auto-dismiss) — an
// explicit Update (skip-waiting + reload into the fresh build) or a dismiss.
// Sits above the mobile chrome; one glass pill matched to the app's recipe.
export function UpdatePrompt({ onUpdate, onDismiss }) {
  return (
    <div className="aura-update" role="status" aria-live="polite">
      <span className="aura-update__dot" aria-hidden="true" />
      <span className="aura-update__text">a new version of aura is ready</span>
      <button type="button" className="aura-update__btn" onClick={onUpdate}>Update</button>
      <button type="button" className="aura-update__x" onClick={onDismiss} aria-label="Dismiss">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path d="M2 2 L9 9 M9 2 L2 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

import { AuraMark } from '../components/primitives';
import './LegalPage.css';

// Shared chrome for the public Privacy / Terms pages: brand + back-to-app,
// a readable centred column, and a contact footer. Renders inside main.jsx's
// `theme-*` wrapper, so it follows the active theme.
export function LegalShell({ title, updated, onBack, children }) {
  return (
    <div className="aura-legal">
      <header className="aura-legal__top">
        <button className="aura-legal__brand" type="button" onClick={onBack}>
          <AuraMark size={20}/>
          <span>aura</span>
        </button>
        <button className="aura-legal__back" type="button" onClick={onBack}>← Back to aura</button>
      </header>
      <main className="aura-legal__main">
        <h1 className="aura-legal__title">{title}</h1>
        {updated && <p className="aura-legal__updated">Last updated {updated}</p>}
        <div className="aura-legal__body">{children}</div>
        <footer className="aura-legal__foot">
          <span>© 2026 AURA FM</span>
          <a href="mailto:privacy@aurafm.live">privacy@aurafm.live</a>
        </footer>
      </main>
    </div>
  );
}

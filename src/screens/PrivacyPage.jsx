import { LegalShell } from './LegalShell';

// Privacy policy. Documents the ACTUAL data the app collects (verified against
// the database schema and the server endpoints), why, who processes it, how long
// it's kept, and the GDPR rights AURA honours. Keep this in sync with the code.
export function PrivacyPage({ onBack }) {
  return (
    <LegalShell title="Privacy Policy" updated="11 June 2026" onBack={onBack}>
      <p>
        AURA FM (“AURA”, “we”) is an AI music player and personal radio at{' '}
        <a href="https://aurafm.live/">aurafm.live</a>. This policy explains exactly what
        we collect, why, who else touches it, and the choices and rights you have. We
        try to collect only what the product genuinely needs.
      </p>

      <h2>What we collect</h2>
      <p><strong>To run your account</strong></p>
      <ul>
        <li>Your <strong>email address</strong> and a <strong>display name</strong>.</li>
        <li>Your <strong>password</strong>, stored only as a salted bcrypt hash — we never see or store the plain text.</li>
        <li>A timestamp of your <strong>last sign-in</strong>.</li>
      </ul>
      <p><strong>When you set up (optional, skippable)</strong></p>
      <ul>
        <li>Your preferred <strong>languages</strong>, a starting <strong>mood</strong>, and a few <strong>seed artists</strong> to jump-start discovery.</li>
      </ul>
      <p><strong>As you listen</strong></p>
      <ul>
        <li>Each time you <strong>play, pause, skip, seek or finish</strong> a track — including the track, the time, and how far you got.</li>
        <li>The <strong>mood</strong> AURA inferred at that moment and the track’s <strong>language</strong>.</li>
        <li>Songs you <strong>like / unlike</strong>, and the <strong>playlists</strong> you create.</li>
      </ul>
      <p><strong>Worked out by our AI</strong></p>
      <ul>
        <li>A rolling <strong>mood read</strong> (with a confidence and a short reason) and an AI-written <strong>listening journal</strong>, both derived from your recent activity.</li>
      </ul>
      <p>
        We do <strong>not</strong> collect your location, contacts, or any browsing outside AURA,
        and we do not store your IP address in our database.
      </p>

      <h2>Why we collect it</h2>
      <ul>
        <li><strong>To read your mood and build your queue</strong> — what you play and skip is how AURA learns the feeling you’re in and picks songs that fit.</li>
        <li><strong>To show your stats and journal</strong> — most-played, top artists, and your daily listening summaries.</li>
        <li><strong>To bring old favourites back</strong> — songs you used to love resurface when your mood matches.</li>
        <li><strong>Account & security</strong> — to sign you in and send verification / password-reset codes.</li>
      </ul>

      <h2>Who else processes your data</h2>
      <p>We use a small number of trusted providers, only for what’s described above:</p>
      <ul>
        <li><strong>Neon</strong> — our PostgreSQL database, where your account and listening history live.</li>
        <li><strong>Google (Gemini API)</strong> — processes your recent listening to infer mood and write your journal. We don’t send your email or password.</li>
        <li><strong>Resend</strong> — receives your email address solely to deliver sign-up and password-reset codes.</li>
        <li><strong>Vercel</strong> — hosting, plus privacy-friendly analytics and performance metrics (only if you allow it — see “Your choices”).</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li><strong>Account, listening history and mood snapshots</strong> — until you delete your account.</li>
        <li><strong>One-time codes</strong> — a few minutes, then deleted.</li>
        <li><strong>AI caches (journal, “why this song”, lyrics)</strong> — refreshed roughly daily.</li>
        <li><strong>On-device settings</strong> (theme, volume, EQ, tour-seen, recent searches) — kept in your browser’s local storage until you clear it; never sent to our servers.</li>
      </ul>

      <h2>Your choices &amp; rights (GDPR)</h2>
      <ul>
        <li><strong>Access / export</strong> — download everything we hold from your account settings (“Export my data”).</li>
        <li><strong>Erasure</strong> — delete your account and all listening history from settings (“Delete my account”). This is permanent.</li>
        <li><strong>Rectification</strong> — change your name, seed artists, languages and mood any time.</li>
        <li><strong>Analytics</strong> — opt in or out of usage analytics from the banner on first visit; nothing analytics-related loads until you allow it.</li>
      </ul>

      <h2>Children</h2>
      <p>AURA isn’t directed at children under 13, and we don’t knowingly collect their data.</p>

      <h2>Changes &amp; contact</h2>
      <p>
        We’ll update this page as the product evolves and revise the date above. Questions or
        requests? Email <a href="mailto:privacy@aurafm.live">privacy@aurafm.live</a>.
      </p>
    </LegalShell>
  );
}

import { LegalShell } from './LegalShell';

// Privacy policy. Documents the ACTUAL data the app collects, stores, infers and
// shares — verified against the database schema (server/db.js), the server
// endpoints, the external integrations, and every client-side storage key.
// Keep this in sync with the code when data handling changes.
export function PrivacyPage({ onBack }) {
  return (
    <LegalShell title="Privacy Policy" updated="11 June 2026" onBack={onBack}>
      <p>
        This policy explains, in plain terms, exactly what AURA FM (“AURA”, “we”, “us”) collects
        when you use the app at <a href="https://aurafm.live/">aurafm.live</a>, why we collect it,
        how the AI uses it, who else can see it, how long we keep it, and the choices and rights you
        have. We try to collect only what the product genuinely needs to work. For privacy questions
        or to exercise any right below, email <a href="mailto:privacy@aurafm.live">privacy@aurafm.live</a> —
        we are the controller of your data.
      </p>

      <h2>1. Data you give us</h2>
      <ul>
        <li><strong>Account</strong> — your email address and a display name.</li>
        <li><strong>Password</strong> — stored only as a salted bcrypt hash. We never see, log, or store the plain text.</li>
        <li><strong>Setup choices (optional, skippable)</strong> — your preferred languages, a starting mood, and a few seed artists.</li>
        <li><strong>Things you create</strong> — playlists (names, descriptions, and the tracks in them), and the songs you like or unlike.</li>
        <li><strong>Conversations</strong> — when you talk to your AI DJ in plain language, we process your messages to queue music and reply.</li>
      </ul>

      <h2>2. Data we collect as you use AURA</h2>
      <ul>
        <li><strong>Listening events</strong> — every time you play, pause, skip, seek, or finish a track, we record the track, the time, how far you got, the track’s language, and the mood AURA read at that moment.</li>
        <li><strong>Account activity</strong> — the time of your last sign-in, and whether you’ve finished onboarding and verified your email.</li>
        <li><strong>Sign-in security</strong> — when you sign up or reset your password, we create a short-lived, hashed one-time code tied to your email.</li>
      </ul>

      <h2>3. Data our AI works out (profiling)</h2>
      <p>
        AURA personalises your experience by inferring things from your behaviour. You should know
        this happens and what it produces:
      </p>
      <ul>
        <li><strong>Mood reads</strong> — a current mood with a confidence score, a “drift”, and a short reason, derived from your recent listening.</li>
        <li><strong>Listening journal</strong> — AI-written daily summaries of your taste.</li>
        <li><strong>“Sonic DNA” &amp; “why this song”</strong> — a taste profile and explanations for picks.</li>
        <li><strong>Auto-playlists</strong> — sets like “on repeat” and “bring it back”, computed from your play history.</li>
      </ul>
      <p>
        This profiling shapes what you’re recommended; it has no legal or similarly significant effect
        on you, and you can stop it at any time by deleting your account.
      </p>

      <h2>4. Data stored on your device</h2>
      <p>
        Some data lives only in your browser’s local storage (it isn’t sent to our servers) so the app
        remembers your session and preferences. This includes: your <strong>sign-in token</strong> and a
        cached copy of your <strong>name and email</strong>; your <strong>theme, volume, mute, and equalizer</strong>
        settings; your <strong>repeat mode</strong>, current <strong>queue</strong> and <strong>playback position</strong>;
        your <strong>DJ chat history</strong>, <strong>recent searches</strong>, onboarding choices, mood-bridge
        setup, sleep-timer and widget positions, the tour-seen flag, and your <strong>analytics choice</strong>.
        Clearing your browser storage (or signing out, which removes your token and most of these) erases them.
      </p>

      <h2>5. What we do NOT collect</h2>
      <ul>
        <li>Your <strong>location</strong>.</li>
        <li>Your <strong>IP address</strong> in our database, your contacts, or any browsing outside AURA.</li>
        <li>Special-category data (health, beliefs, etc.). Mood is inferred from music behaviour only.</li>
        <li>We do not sell your data, and we do not use it for third-party advertising.</li>
      </ul>

      <h2>6. Why we use your data &amp; our legal bases</h2>
      <ul>
        <li><strong>To provide the service</strong> — sign you in, build and adapt your queue, read your mood, and run features you ask for. <em>Legal basis: performance of our contract with you.</em></li>
        <li><strong>To improve and personalise</strong> — stats, journal, recommendations, and resurfacing old favourites. <em>Legal basis: our legitimate interest in making the product useful, balanced against your rights.</em></li>
        <li><strong>Security &amp; account recovery</strong> — verification and password-reset codes. <em>Legal basis: contract and our legitimate interest in keeping accounts safe.</em></li>
        <li><strong>Usage analytics</strong> — only if you allow it. <em>Legal basis: your consent, which you can withdraw any time.</em></li>
      </ul>

      <h2>7. Who we share it with</h2>
      <p>We use a small set of trusted processors, only for the purposes above, and never to sell your data:</p>
      <ul>
        <li><strong>Neon</strong> — our PostgreSQL database host, where your account and listening history are stored.</li>
        <li><strong>Google (Gemini API)</strong> — receives your recent listening events and inferred mood to generate mood reads, your journal, “why this song”, and DJ replies. We don’t send your email or password.</li>
        <li><strong>Resend</strong> — receives your email address only, to deliver sign-up and password-reset codes.</li>
        <li><strong>A third-party music catalogue / CDN</strong> — receives your search terms and track identifiers to return search results, metadata, lyrics, and audio streams.</li>
        <li><strong>Vercel</strong> — hosts the app and, only if you consent, provides privacy-friendly usage analytics and performance metrics (Vercel Analytics &amp; Speed Insights).</li>
      </ul>
      <p>
        We may also disclose data if required by law, to protect our rights or users’ safety, or as part
        of a business transfer (you’ll be notified of any material change).
      </p>

      <h2>8. International transfers</h2>
      <p>
        Our providers may process data on servers outside your country. Where data leaves your region,
        it’s protected by the providers’ contractual safeguards and security measures.
      </p>

      <h2>9. Cookies &amp; similar technologies</h2>
      <ul>
        <li><strong>Essential</strong> — your sign-in token is kept in your browser’s local storage to keep you logged in. The app can’t work without it.</li>
        <li><strong>Analytics</strong> — Vercel Analytics / Speed Insights load <strong>only after you choose “Allow”</strong> on the consent banner. Choose “No thanks” and nothing analytics-related runs. You can change your mind by clearing the choice in your browser storage.</li>
        <li>We use no advertising or cross-site tracking cookies.</li>
      </ul>

      <h2>10. How long we keep it</h2>
      <ul>
        <li><strong>Account, listening history, mood snapshots, playlists, likes</strong> — until you delete your account.</li>
        <li><strong>One-time codes</strong> — a few minutes, then deleted.</li>
        <li><strong>AI caches (journal, “why”, lyrics)</strong> — refreshed roughly daily.</li>
        <li><strong>On-device data</strong> — until you sign out or clear your browser storage.</li>
      </ul>

      <h2>11. How we protect it</h2>
      <p>
        Passwords are hashed with bcrypt; traffic is encrypted in transit (HTTPS); access is gated by
        signed session tokens. No system is perfectly secure, but we work to protect your data and limit
        what each provider can see to what they need.
      </p>

      <h2>12. Your rights</h2>
      <p>Depending on where you live, you can:</p>
      <ul>
        <li><strong>Access / export</strong> your data — download everything we hold from account settings (“Export my data”).</li>
        <li><strong>Delete</strong> your account and all listening history — from settings (“Delete my account”). This is permanent.</li>
        <li><strong>Correct</strong> your name, seed artists, languages, and mood any time.</li>
        <li><strong>Restrict or object</strong> to certain processing, and <strong>withdraw consent</strong> to analytics.</li>
        <li><strong>Port</strong> your data — the export is machine-readable JSON.</li>
        <li><strong>Complain</strong> to your local data-protection authority if you think we’ve mishandled your data.</li>
      </ul>
      <p>Exercise any of these from settings, or email <a href="mailto:privacy@aurafm.live">privacy@aurafm.live</a>.</p>

      <h2>13. Children</h2>
      <p>AURA isn’t directed at children under 13, and we don’t knowingly collect their data. If you believe a child has given us data, contact us and we’ll remove it.</p>

      <h2>14. Changes to this policy</h2>
      <p>
        We’ll update this page as the product evolves and revise the date at the top. Significant changes
        will be highlighted in the app. Continuing to use AURA after a change means you accept the updated policy.
      </p>

      <h2>15. Contact</h2>
      <p>Questions or requests: <a href="mailto:privacy@aurafm.live">privacy@aurafm.live</a>.</p>
    </LegalShell>
  );
}

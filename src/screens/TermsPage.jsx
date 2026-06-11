import { LegalShell } from './LegalShell';

// Terms & Conditions. Plain-language but comprehensive; honest about
// early-access status. Governing law is left general — set your specific
// jurisdiction and legal-entity name before relying on this.
export function TermsPage({ onBack }) {
  return (
    <LegalShell title="Terms &amp; Conditions" updated="11 June 2026" onBack={onBack}>
      <p>
        These Terms are a binding agreement between you and AURA FM (“AURA”, “we”, “us”) covering your
        use of the app and website at <a href="https://aurafm.live/">aurafm.live</a> (the “Service”). By
        creating an account or using the Service, you agree to these Terms and to our{' '}
        <a href="/privacy">Privacy Policy</a>. If you don’t agree, please don’t use the Service.
      </p>

      <h2>1. Definitions</h2>
      <ul>
        <li><strong>“Service”</strong> — the AURA FM apps, website, AI features, and related software.</li>
        <li><strong>“Content”</strong> — music, lyrics, metadata, text, and other material available in the Service.</li>
        <li><strong>“Your Content”</strong> — things you create, such as playlists and DJ messages.</li>
      </ul>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 13 years old, and old enough to form a binding contract and consent to data
        processing where you live. If you’re under the age of majority, you confirm a parent or guardian
        agrees to these Terms on your behalf.
      </p>

      <h2>3. Your account &amp; security</h2>
      <ul>
        <li>Provide accurate information and a valid email so we can verify and recover your account.</li>
        <li>You’re responsible for keeping your credentials secure and for all activity under your account.</li>
        <li>Tell us promptly at <a href="mailto:hello@aurafm.live">hello@aurafm.live</a> if you suspect unauthorised use.</li>
        <li>One person per account; don’t share, sell, or transfer your account.</li>
      </ul>

      <h2>4. Licence to use the Service</h2>
      <p>
        We grant you a personal, limited, non-exclusive, non-transferable, revocable licence to use the
        Service for your own, non-commercial enjoyment, subject to these Terms. We reserve all rights not
        expressly granted.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Break the law, or infringe anyone’s intellectual-property, privacy, or other rights.</li>
        <li>Copy, download, record, redistribute, publicly perform, or strip rights-management from streamed music.</li>
        <li>Reverse-engineer, decompile, scrape, or build a competing product from the Service.</li>
        <li>Interfere with, overload, attack, or attempt to gain unauthorised access to the Service or its systems.</li>
        <li>Use bots or automated means to access the Service, or bypass any access or usage limits.</li>
        <li>Upload malware, or post unlawful, abusive, hateful, or infringing material.</li>
      </ul>

      <h2>6. Your Content</h2>
      <p>
        You keep ownership of Your Content. You grant us a worldwide, royalty-free licence to host, store,
        and process it solely to operate and improve the Service for you (for example, saving your playlists
        and responding to your DJ messages). You’re responsible for Your Content and confirm you have the
        right to share it. You can delete it, and deleting your account removes it as described in the Privacy Policy.
      </p>

      <h2>7. Music &amp; intellectual property</h2>
      <p>
        Music, lyrics, artwork, and metadata are streamed from third-party catalogue providers and remain the
        property of their rights holders, available to you for personal streaming only. The AURA name, logo,
        design, and software are owned by us and protected by law. Nothing in these Terms transfers ownership
        of any Content or our intellectual property to you.
      </p>

      <h2>8. AI features</h2>
      <p>
        AURA uses AI to infer your mood and generate recommendations, journals, and explanations. These are
        automated, best-effort, and may be inaccurate or unexpected. They are for entertainment only and are
        not advice of any kind. Don’t rely on them as factual or professional guidance.
      </p>

      <h2>9. Privacy</h2>
      <p>
        Our <a href="/privacy">Privacy Policy</a> explains what we collect and why. You can export or delete
        your data at any time from your account settings.
      </p>

      <h2>10. Early access &amp; changes to the Service</h2>
      <p>
        The Service is in <strong>early access</strong>. Features may change, break, be added, or be removed
        as we build, and some parts may be experimental. We may modify, suspend, or discontinue any part of
        the Service at any time.
      </p>

      <h2>11. Service “as is” — disclaimers</h2>
      <p>
        To the maximum extent permitted by law, the Service is provided “as is” and “as available”, without
        warranties of any kind, express or implied, including fitness for a particular purpose,
        merchantability, accuracy, or non-infringement. We don’t guarantee the Service will be uninterrupted,
        secure, or error-free, or that any Content will always be available.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, AURA and its suppliers won’t be liable for any indirect,
        incidental, special, consequential, or punitive damages, or for lost data, profits, or goodwill,
        arising from your use of (or inability to use) the Service. Where liability can’t be excluded, it’s
        limited to the amount you paid us for the Service in the 12 months before the claim (which, during
        free early access, may be zero). Some jurisdictions don’t allow certain limits, so some of these may
        not apply to you.
      </p>

      <h2>13. Indemnity</h2>
      <p>
        You agree to indemnify and hold AURA harmless from claims, losses, and costs arising out of your
        misuse of the Service or breach of these Terms, to the extent permitted by law.
      </p>

      <h2>14. Suspension &amp; termination</h2>
      <p>
        You can stop using the Service and delete your account at any time. We may suspend or terminate
        accounts that breach these Terms or harm the Service or other users. Deleting your account permanently
        removes your data as described in the Privacy Policy. Sections that by their nature should survive
        (e.g. intellectual property, disclaimers, liability) continue after termination.
      </p>

      <h2>15. Governing law &amp; disputes</h2>
      <p>
        These Terms are governed by the laws applicable where AURA FM is operated, without regard to
        conflict-of-law rules. If you’re a consumer, you keep the protections of the mandatory laws of your
        country of residence. We’ll try to resolve any dispute informally first — email us before taking
        formal action.
      </p>

      <h2>16. Changes to these Terms</h2>
      <p>
        We may update these Terms and will revise the date above; significant changes will be highlighted in
        the app. Continuing to use the Service after a change means you accept the updated Terms.
      </p>

      <h2>17. General</h2>
      <ul>
        <li>If any part of these Terms is unenforceable, the rest still applies.</li>
        <li>Our not enforcing a right isn’t a waiver of it.</li>
        <li>You may not assign these Terms; we may assign them as part of a business transfer.</li>
        <li>These Terms and the Privacy Policy are the entire agreement between us about the Service.</li>
      </ul>

      <h2>18. Contact</h2>
      <p>Questions about these Terms: <a href="mailto:hello@aurafm.live">hello@aurafm.live</a>.</p>
    </LegalShell>
  );
}

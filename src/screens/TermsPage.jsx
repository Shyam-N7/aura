import { LegalShell } from './LegalShell';

// Terms & Conditions. Plain-language, honest about early-access status.
export function TermsPage({ onBack }) {
  return (
    <LegalShell title="Terms &amp; Conditions" updated="11 June 2026" onBack={onBack}>
      <p>
        Welcome to AURA FM. By creating an account or using AURA at{' '}
        <a href="https://aurafm.live/">aurafm.live</a>, you agree to these terms. If you
        don’t agree, please don’t use the service.
      </p>

      <h2>1. The service</h2>
      <p>
        AURA is an AI music player and personal radio in <strong>early access</strong>. Features
        may change, break, or be added and removed as we build. We provide it on a best-effort,
        “as is” basis without warranties of any kind.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You’re responsible for keeping your login details secure and for activity on your account.</li>
        <li>Provide accurate information, and a valid email so we can verify and recover your account.</li>
        <li>You must be old enough to consent to data processing where you live (at least 13).</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Break the law, infringe others’ rights, or abuse, attack, or overload the service.</li>
        <li>Reverse-engineer, scrape, or resell the service, or circumvent its access controls.</li>
        <li>Attempt to download, redistribute, or strip rights-management from streamed music.</li>
      </ul>

      <h2>4. Music &amp; content</h2>
      <p>
        Music is streamed from third-party catalogue providers and remains the property of its
        rights holders. AURA grants you a personal, non-transferable right to stream it for your
        own listening only. The AURA name, design, and software are ours.
      </p>

      <h2>5. Your data</h2>
      <p>
        How we handle your data is covered in our{' '}
        <a href="/privacy">Privacy Policy</a>. You can export or delete your data at any time from
        your account settings.
      </p>

      <h2>6. Availability &amp; liability</h2>
      <p>
        We don’t guarantee uninterrupted or error-free service and may suspend or change it at any
        time. To the maximum extent allowed by law, AURA isn’t liable for indirect or
        consequential losses arising from your use of the service.
      </p>

      <h2>7. Termination</h2>
      <p>
        You can delete your account at any time. We may suspend or terminate accounts that breach
        these terms. Deleting your account permanently removes your data as described in the
        Privacy Policy.
      </p>

      <h2>8. Changes &amp; contact</h2>
      <p>
        We may update these terms and will revise the date above; continued use means you accept
        the changes. Questions? Email <a href="mailto:hello@aurafm.live">hello@aurafm.live</a>.
      </p>
    </LegalShell>
  );
}

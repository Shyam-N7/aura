// Transactional email via Resend — used for signup verification and password
// reset OTP codes. The provider SDK is lazy-imported + cached so the server
// boots fine without `resend` configured (dev runs on the echo fallback).
//
// Env:
//   RESEND_API_KEY — from resend.com. Absent → see MAIL_DEV_ECHO.
//   MAIL_FROM      — verified sender, e.g. "AURA <hello@yourdomain.com>".
//   MAIL_DEV_ECHO  — "1" to log codes to the server console instead of sending
//                    real mail (offline dev). Ignored once RESEND_API_KEY is set.

let _resend = null;

export function mailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

function devEcho() {
  return process.env.MAIL_DEV_ECHO === '1';
}

async function getResend() {
  if (!_resend) {
    const { Resend } = await import('resend');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

// Sends an email. Throws an Error carrying `.statusCode` on failure so routes
// can surface a clean HTTP status. In dev with MAIL_DEV_ECHO=1 and no provider
// configured, logs the message to the console and resolves.
export async function sendMail({ to, subject, html, text }) {
  if (!mailConfigured()) {
    if (devEcho()) {
      console.log(`\n[email:dev-echo] → ${to}\n  subject: ${subject}\n  ${text}\n`);
      return { dev: true };
    }
    const err = new Error('email is not configured — set RESEND_API_KEY + MAIL_FROM (or MAIL_DEV_ECHO=1 for dev)');
    err.statusCode = 503;
    throw err;
  }
  try {
    const resend = await getResend();
    const { error } = await resend.emails.send({ from: process.env.MAIL_FROM, to, subject, html, text });
    if (error) {
      const err = new Error(`email send failed: ${error.message || error}`);
      err.statusCode = 502;
      throw err;
    }
    return { sent: true };
  } catch (e) {
    if (e.statusCode) throw e;
    const err = new Error(`email send failed: ${e.message}`);
    err.statusCode = 502;
    throw err;
  }
}

// Builds the OTP email for either purpose. Inline styles only — email clients
// strip <style> blocks and don't have the app's bundled fonts, so we use warm
// literal colours (light/dusk palette) + web-safe serif/mono fallbacks.
export function renderOtpEmail({ code, purpose }) {
  const reset = purpose === 'reset';
  const subject = reset ? `your aura password reset code: ${code}` : `your aura code: ${code}`;
  const heading = reset ? 'reset your password.' : 'almost there.';
  const line = reset
    ? 'Enter this code in aura to set a new password. It expires in 10 minutes.'
    : 'Enter this code in aura to verify your email and finish setting up. It expires in 10 minutes.';
  const text = `${heading}\n\nyour code is ${code}\n\n${line}\n\nIf you didn't request this, you can safely ignore this email.\n— aura`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#e9dfd1;">
  <div style="margin:0;padding:32px 16px;background:#e9dfd1;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:440px;margin:0 auto;background:#f4ece0;border-radius:20px;padding:40px 36px;text-align:center;">
      <div style="font-family:Georgia,serif;font-style:italic;font-size:24px;color:#2a221c;">aura</div>
      <h1 style="font-family:Georgia,serif;font-weight:400;font-size:30px;line-height:1.1;color:#2a221c;margin:24px 0 8px;">${heading}</h1>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#6b6259;margin:0 0 28px;">${line}</p>
      <div style="font-family:'Courier New',Courier,monospace;font-weight:700;font-size:34px;letter-spacing:0.3em;color:#2a221c;background:#e9dfd1;border-radius:12px;padding:18px 0 18px 12px;">${code}</div>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#9a9089;margin:28px 0 0;">If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9a9089;margin-top:18px;">aura · music that gets your mood</div>
  </div>
</body></html>`;
  return { subject, html, text };
}

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
  const subject = reset ? 'Reset your AURA password' : 'Your AURA verification code';
  const heading = reset ? 'Reset your password' : 'Verify your email';
  const intro = reset
    ? 'Enter this code to set a new password for your account.'
    : 'Enter this code to finish setting up your account.';
  // Inbox preview line (sits next to the subject in most clients).
  const preheader = `Your code is ${code} — expires in 10 minutes.`;

  const text = [
    heading,
    '',
    intro,
    '',
    `Your code: ${code}`,
    'This code expires in 10 minutes.',
    '',
    "If you didn't request this, you can safely ignore this email.",
    '',
    'aura — music that gets your mood',
    "Sent by aurafm.live. This is an automated message; please don't reply.",
  ].join('\n');

  // Table-based layout + inline styles for cross-client rendering (Gmail,
  // Outlook, Apple Mail). Literal warm-palette hex — clients strip <style> and
  // don't have the app's bundled fonts, so we fall back to serif/sans/mono.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${subject}</title>
</head>
<body style="margin:0; padding:0; background-color:#e9dfd1;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${preheader}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e9dfd1;">
  <tr>
    <td align="center" style="padding:44px 16px;">
      <table role="presentation" width="464" cellpadding="0" cellspacing="0" border="0" style="width:464px; max-width:464px;">
        <tr>
          <td align="center" style="padding:0 0 22px;">
            <span style="font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:22px; letter-spacing:0.02em; color:#2a221c;">aura</span>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f6efe4; border-radius:18px; padding:42px 40px 34px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding:0 0 18px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td height="3" width="34" style="height:3px; width:34px; background-color:#bb6a44; border-radius:2px; font-size:0; line-height:0;">&nbsp;</td>
                  </tr></table>
                </td>
              </tr>
              <tr>
                <td align="center" style="font-family:Georgia,'Times New Roman',serif; font-weight:400; font-size:27px; line-height:1.2; color:#2a221c; padding:0 0 10px;">${heading}</td>
              </tr>
              <tr>
                <td align="center" style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#6b6259; padding:0 0 28px;">${intro}</td>
              </tr>
              <tr>
                <td align="center" style="padding:0 0 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td align="center" style="background-color:#ece2d3; border-radius:12px; padding:18px 30px; font-family:'Courier New',Courier,monospace; font-weight:700; font-size:34px; letter-spacing:0.30em; color:#2a221c;">${code}</td>
                  </tr></table>
                </td>
              </tr>
              <tr>
                <td align="center" style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#9a9089;">This code expires in 10 minutes.</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#9a9089; padding:22px 24px 0;">If you didn't request this, you can safely ignore this email — your account stays secure.</td>
        </tr>
        <tr>
          <td align="center" style="font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.7; color:#b3a99f; padding:22px 16px 0;">
            <span style="color:#9a9089;">aura</span> &middot; music that gets your mood<br>
            Sent by aurafm.live — this is an automated message; please don't reply.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

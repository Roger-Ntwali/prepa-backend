// Thin wrapper around Resend's REST API (https://resend.com/docs/api-reference/emails/send-email)
// for the one email this backend sends: a password-reset code. Talks to
// Resend directly via fetch, matching how gemini.js calls Google's API --
// no extra npm dependency for a single POST request.
//
// Get a key at https://resend.com/api-keys and set it as RESEND_API_KEY in
// .env. RESEND_FROM_EMAIL should be an address on a domain you've verified
// with Resend; unset, it falls back to Resend's sandbox sender, which only
// delivers to the email on your own Resend account -- fine for testing,
// not for real teachers/students.
//
// Never throws: a missing key or a failed send is logged and swallowed, so
// a broken/unconfigured mailer can never turn a password-reset request into
// a 500 for the caller. Callers that care whether the email actually went
// out can check the boolean return value; the forgot-password endpoint
// deliberately doesn't, since its response must look identical whether or
// not the email exists or the send succeeded.
async function sendResetCodeEmail(to, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      `RESEND_API_KEY is not set -- skipped emailing the reset code to ${to}. Set it in .env to enable password-reset emails.`
    );
    return false;
  }

  const from = process.env.RESEND_FROM_EMAIL || 'PREPA <onboarding@resend.dev>';
  // Logged unconditionally (not just folded into the error path below) so
  // "did it even try to send, and to/from what" is never a guess when
  // reading logs after the fact.
  console.log(`Sending reset code email: from="${from}" to="${to}"`);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: 'Your PREPA password reset code',
        text: `Your password reset code is ${code}. It expires in 15 minutes. If you didn't request this, you can ignore this email.`,
        html: `<p>Your password reset code is <strong>${code}</strong>.</p><p>It expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      console.error(
        `Resend API error (status ${res.status}) sending reset code to ${to}:`,
        data?.message || data
      );
      return false;
    }
    // Resend's success response includes an `id` for the sent email -- the
    // one thing that lets this be looked up in the Resend dashboard's
    // Emails/Logs page to check actual delivery status (accepted by Resend
    // is not the same as delivered to the inbox).
    console.log(`Resend accepted the reset code email: id=${data?.id} to="${to}"`);
    return true;
  } catch (err) {
    console.error(`Failed to send reset code email to ${to}:`, err.message);
    return false;
  }
}

module.exports = { sendResetCodeEmail };

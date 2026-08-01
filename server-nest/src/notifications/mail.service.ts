import { Injectable, Logger } from '@nestjs/common';

/**
 * Sends transactional email via Resend's HTTP API (https://resend.com).
 *
 * Why not SMTP (Gmail etc)? Railway's network was found to block outbound
 * SMTP connections entirely (both port 465 and 587 timed out from inside
 * the container, confirmed via server logs during setup) — this is common
 * on PaaS platforms that restrict outbound traffic to HTTP(S) only. Resend
 * sidesteps that completely: sending an email is just a normal HTTPS POST,
 * identical in kind to any other third-party API call this backend already
 * makes, so it isn't subject to the SMTP port block.
 *
 * Requires one env var on the server (Railway → Variables):
 *   RESEND_API_KEY   from https://resend.com/api-keys (starts with "re_")
 *
 * Optional:
 *   RESEND_FROM_EMAIL   defaults to 'onboarding@resend.dev' (Resend's
 *                        shared test sender — works immediately with zero
 *                        setup, no domain verification needed, but lands in
 *                        Spam more often than a verified custom domain
 *                        would). Once a domain is verified in the Resend
 *                        dashboard, set this to an address on it instead
 *                        (e.g. login@citrinejuice.com).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  private async send(to: string, subject: string, html: string, text: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set — this email will NOT be sent.');
      return;
    }

    const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: `Citrine Juice Co. <${from}>`, to: [to], subject, html, text }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Resend API rejected an email to ${to}: ${res.status} ${body}`);
        return;
      }

      this.logger.log(`Email sent to ${to} via Resend (subject: "${subject}").`);
    } catch (err) {
      // Don't let an email-provider outage break the caller's flow entirely
      // (login/password-reset still succeeds server-side) — surface the
      // failure in logs so it's debuggable instead.
      this.logger.error(`Failed to send email to ${to} via Resend: ${(err as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Shared layout — brand colors match customer/style.css's CSS variables
  // (--blood-orange, --ink-plum, --paper) so emails feel like the same
  // product as the site, not a generic transactional-email template.
  // -------------------------------------------------------------------------
  private layout(bodyHtml: string): string {
    return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#F3EEE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEE4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#FFFDF9;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(30,16,48,0.10);">
            <tr>
              <td style="background:#1E1030;padding:28px 32px;">
                <span style="font-size:22px;font-weight:800;color:#FFFDF9;letter-spacing:0.3px;">🍊 Citrine Juice Co.</span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#F3EEE4;">
                <p style="margin:0;font-size:12px;color:#1E1030;opacity:0.55;line-height:1.6;">
                  You're receiving this because it was requested on Citrine Juice Co. If this wasn't you, no action is needed — nothing changes unless the code above is used.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    const html = this.layout(`
      <p style="margin:0 0 6px;font-size:15px;color:#1E1030;opacity:0.7;">Your one-time login code</p>
      <div style="margin:18px 0 22px;padding:20px;background:#F3EEE4;border-radius:14px;text-align:center;">
        <span style="font-size:38px;font-weight:800;letter-spacing:10px;color:#E1461C;">${code}</span>
      </div>
      <p style="margin:0;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        Enter this code on the sign-in screen to continue. It expires in <strong>5 minutes</strong>.
      </p>
    `);
    const text = `Your Citrine Juice Co. login code is: ${code}\n\nThis code expires in 5 minutes. If you didn't request this, you can ignore this email.`;
    await this.send(to, `${code} is your Citrine login code`, html, text);
  }

  /**
   * Sent after a password is successfully changed (via the forgot/reset
   * flow, since that's the only path that currently changes a password) —
   * a security notification, not an action the recipient needs to take, so
   * the copy is reassuring rather than another code to enter.
   */
  async sendPasswordChangedEmail(to: string): Promise<void> {
    const when = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const html = this.layout(`
      <div style="margin:0 0 18px;width:48px;height:48px;border-radius:50%;background:#2F6B4F;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:24px;line-height:48px;">✓</span>
      </div>
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#1E1030;">Your password was changed</p>
      <p style="margin:0 0 20px;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        This confirms the password on your Citrine account was successfully updated on <strong>${when}</strong>. You've been signed out everywhere else as a precaution.
      </p>
      <p style="margin:0;font-size:13px;color:#1E1030;opacity:0.6;line-height:1.6;">
        Didn't make this change? Reset your password again immediately from the sign-in screen, or reply to this email.
      </p>
    `);
    const text = `Your Citrine Juice Co. password was changed on ${when}.\n\nYou've been signed out everywhere else as a precaution. If this wasn't you, reset your password again immediately.`;
    await this.send(to, 'Your Citrine password was changed', html, text);
  }
}

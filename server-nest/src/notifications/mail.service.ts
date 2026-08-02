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
 *                        (e.g. login@example-monastery.org).
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
        body: JSON.stringify({ from: `Monastery Guesthouse <${from}>`, to: [to], subject, html, text }),
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
                <span style="font-size:22px;font-weight:800;color:#FFFDF9;letter-spacing:0.3px;">⛪ Monastery Guesthouse</span>
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
                  You're receiving this because it was requested on the Monastery Guesthouse system. If this wasn't you, no action is needed — nothing changes unless the code above is used.
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

  private static readonly OTP_LABELS: Record<string, string> = {
    login: 'Your one-time login code',
    verify_email: 'Verify your email to activate your account',
    reset_password: 'Reset your password',
    change_password: 'Confirm your password change',
  };

  async sendOtpEmail(to: string, code: string, purpose = 'login'): Promise<void> {
    const label = MailService.OTP_LABELS[purpose] || 'Your verification code';
    const html = this.layout(`
      <p style="margin:0 0 6px;font-size:15px;color:#1E1030;opacity:0.7;">${label}</p>
      <div style="margin:18px 0 22px;padding:20px;background:#F3EEE4;border-radius:14px;text-align:center;">
        <span style="font-size:38px;font-weight:800;letter-spacing:10px;color:#E1461C;">${code}</span>
      </div>
      <p style="margin:0;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        Enter this code to continue. It expires in <strong>10 minutes</strong>.
      </p>
    `);
    const text = `${label}: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`;
    await this.send(to, `${code} — ${label}`, html, text);
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
        This confirms the password on your account was successfully updated on <strong>${when}</strong>. You've been signed out everywhere else as a precaution.
      </p>
      <p style="margin:0;font-size:13px;color:#1E1030;opacity:0.6;line-height:1.6;">
        Didn't make this change? Reset your password again immediately from the sign-in screen, or reply to this email.
      </p>
    `);
    const text = `Your password was changed on ${when}.\n\nYou've been signed out everywhere else as a precaution. If this wasn't you, reset your password again immediately.`;
    await this.send(to, 'Your password was changed', html, text);
  }

  // -------------------------------------------------------------------------
  // Booking notifications
  // -------------------------------------------------------------------------

  async sendBookingReceivedEmail(to: string, code: string): Promise<void> {
    const html = this.layout(`
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#1E1030;">Booking request received</p>
      <p style="margin:0 0 20px;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        We received your booking request (reference <strong>${code}</strong>). Our booking team will review it and get back to you shortly.
      </p>
    `);
    await this.send(to, `Booking request received — ${code}`, html, `Your booking request (${code}) was received and is pending review.`);
  }

  async sendBookingApprovedEmail(to: string, code: string, qrCodeDataUrl?: string): Promise<void> {
    const qrBlock = qrCodeDataUrl
      ? `<div style="margin:18px 0;text-align:center;"><img src="${qrCodeDataUrl}" width="180" height="180" alt="Booking QR code" style="border-radius:12px;" /></div>`
      : '';
    const html = this.layout(`
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#1E1030;">Your booking is confirmed</p>
      <p style="margin:0 0 12px;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        Booking reference: <strong>${code}</strong>
      </p>
      ${qrBlock}
      <p style="margin:0;font-size:13px;color:#1E1030;opacity:0.6;line-height:1.6;">
        Please present this QR code on arrival to check in.
      </p>
    `);
    await this.send(to, `Booking confirmed — ${code}`, html, `Your booking (${code}) has been approved. Please present your QR code on arrival.`);
  }

  async sendBookingRejectedEmail(to: string, code: string, reason?: string): Promise<void> {
    const html = this.layout(`
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#1E1030;">Booking request declined</p>
      <p style="margin:0 0 20px;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        Unfortunately your booking request (${code}) could not be accepted.${reason ? ` Reason: ${reason}` : ''}
      </p>
    `);
    await this.send(to, `Booking declined — ${code}`, html, `Your booking request (${code}) was declined.${reason ? ` Reason: ${reason}` : ''}`);
  }

  async sendBookingReminderEmail(to: string, code: string, hoursBefore: number): Promise<void> {
    const html = this.layout(`
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#1E1030;">Reminder: your stay is coming up</p>
      <p style="margin:0 0 20px;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        This is a reminder that your booking (<strong>${code}</strong>) arrival is in about ${hoursBefore} hours.
      </p>
    `);
    await this.send(to, `Reminder — booking ${code}`, html, `Reminder: your booking (${code}) arrival is in about ${hoursBefore} hours.`);
  }

  async sendCheckInEmail(to: string, code: string): Promise<void> {
    const html = this.layout(`
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#1E1030;">You're checked in</p>
      <p style="margin:0 0 20px;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        Check-in confirmed for booking <strong>${code}</strong>. We hope you have a blessed stay.
      </p>
    `);
    await this.send(to, `Checked in — ${code}`, html, `Check-in confirmed for booking ${code}.`);
  }

  async sendStayCompletedEmail(to: string, code: string): Promise<void> {
    const html = this.layout(`
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#1E1030;">Thank you for staying with us</p>
      <p style="margin:0 0 20px;font-size:14px;color:#1E1030;opacity:0.75;line-height:1.6;">
        Your stay (booking <strong>${code}</strong>) has ended. Thank you, and we hope to welcome you again soon.
      </p>
    `);
    await this.send(to, `Thank you — ${code}`, html, `Your stay (${code}) has ended. Thank you for visiting.`);
  }
}

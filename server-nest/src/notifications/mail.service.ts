import { Injectable, Logger } from '@nestjs/common';

/**
 * Sends transactional email (currently just login OTP codes) via Resend's
 * HTTP API (https://resend.com).
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
 *                        setup, no domain verification needed). Once a
 *                        custom domain is verified in the Resend dashboard,
 *                        set this to an address on that domain instead
 *                        (e.g. login@citrinejuice.com) for a branded sender.
 *
 * If RESEND_API_KEY is missing, sendOtpEmail() logs a warning and returns
 * without throwing — so the rest of the login flow doesn't hard-crash in an
 * environment that hasn't configured email yet.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendOtpEmail(to: string, code: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set — OTP emails will NOT be sent.');
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
        body: JSON.stringify({
          from: `Citrine Juice Co. <${from}>`,
          to: [to],
          subject: `${code} is your Citrine login code`,
          text: `Your Citrine Juice Co. login code is: ${code}\n\nThis code expires in 5 minutes. If you didn't request this, you can ignore this email.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
              <h2 style="margin: 0 0 12px;">🍊 Citrine Juice Co.</h2>
              <p style="color: #333;">Your login code is:</p>
              <p style="font-size: 32px; font-weight: 700; letter-spacing: 4px; margin: 12px 0;">${code}</p>
              <p style="color: #777; font-size: 13px;">This code expires in 5 minutes. If you didn't request this, you can safely ignore this email.</p>
            </div>`,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Resend API rejected the email to ${to}: ${res.status} ${body}`);
        return;
      }

      this.logger.log(`OTP email sent to ${to} via Resend.`);
    } catch (err) {
      // Don't let an email-provider outage break login entirely — surface it
      // in logs so it's debuggable, but the OTP row already exists in the DB.
      this.logger.error(`Failed to send OTP email to ${to} via Resend: ${(err as Error).message}`);
    }
  }
}

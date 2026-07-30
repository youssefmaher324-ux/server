import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Sends transactional email (currently just login OTP codes) via Gmail SMTP.
 *
 * Requires two env vars on the server (Railway → Variables):
 *   GMAIL_USER          the Gmail address sending the mail, e.g. citrine.juice@gmail.com
 *   GMAIL_APP_PASSWORD  a 16-character Google "App Password" — NOT the normal
 *                        Gmail password. Generate one at
 *                        https://myaccount.google.com/apppasswords
 *                        (requires 2-Step Verification to be turned on first).
 *
 * If either var is missing, sendOtpEmail() logs a warning and returns
 * without throwing — so the rest of the login flow doesn't hard-crash in an
 * environment that hasn't configured email yet. The caller (AuthService)
 * still tells the user "code sent" only after this actually attempts
 * delivery, but check the server logs if codes aren't arriving.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  private buildTransporter(port: 465 | 587, user: string, pass: string) {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user, pass },
      family: 4, // see getTransporter() comment — avoids the IPv6 timeout trap
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }

  private getTransporter(): nodemailer.Transporter | null {
    if (this.transporter) return this.transporter;

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      this.logger.warn('GMAIL_USER / GMAIL_APP_PASSWORD not set — OTP emails will NOT be sent.');
      return null;
    }

    this.transporter = this.buildTransporter(465, user, pass);
    return this.transporter;
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) return;

    const mail = {
      from: `"Citrine Juice Co." <${process.env.GMAIL_USER}>`,
      to,
      subject: `${code} is your Citrine login code`,
      text: `Your Citrine Juice Co. login code is: ${code}\n\nThis code expires in 5 minutes. If you didn't request this, you can ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
          <h2 style="margin: 0 0 12px;">🍊 Citrine Juice Co.</h2>
          <p style="color: #333;">Your login code is:</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 4px; margin: 12px 0;">${code}</p>
          <p style="color: #777; font-size: 13px;">This code expires in 5 minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>`,
    };

    try {
      await transporter.sendMail(mail);
      return;
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Failed to send OTP email to ${to} via port 465: ${message}`);

      // Only worth retrying on a genuine connectivity failure (timeout /
      // refused / network unreachable) — not on an auth error, which port
      // 587 would fail identically.
      if (!/timeout|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/i.test(message)) return;
    }

    try {
      const user = process.env.GMAIL_USER!;
      const pass = process.env.GMAIL_APP_PASSWORD!;
      const fallback = this.buildTransporter(587, user, pass);
      await fallback.sendMail(mail);
      // This network path works — use it for subsequent emails too.
      this.transporter = fallback;
    } catch (err) {
      // Don't let an email-provider outage break login entirely — surface it
      // in logs so it's debuggable, but the OTP row already exists in the DB.
      this.logger.error(`Failed to send OTP email to ${to} via port 587 fallback: ${(err as Error).message}`);
    }
  }
}

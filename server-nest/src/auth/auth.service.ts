import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { getJwtAccessSecret } from '../config/jwt.config';
import { MailService } from '../notifications/mail.service';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS_DEFAULT = 30;
const REFRESH_TOKEN_TTL_DAYS_SHORT = 1; // when rememberMe is false

function randomOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private mail: MailService,
  ) {}

  // ---- OTP ---------------------------------------------------------------

  async requestOtp(identifier: string, purpose: 'login' | 'verify_email' | 'reset_password' = 'login') {
    const isEmail = identifier.includes('@');
    // SMS delivery isn't wired up yet (no provider configured) — only email
    // identifiers can actually receive a code right now. Reject phone
    // numbers explicitly instead of silently returning success:true for a
    // code nobody will ever see.
    if (!isEmail) {
      throw new BadRequestException('Please use your email address to sign in — phone/SMS login isn\'t available yet.');
    }

    const code = randomOtp();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const user = await this.prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { phone: identifier },
    });

    await this.prisma.otpCode.create({
      data: { userId: user?.id, identifier, codeHash, purpose, expiresAt },
    });

    // Always log locally for easy debugging; always attempt real delivery
    // too (MailService no-ops safely if GMAIL_USER/GMAIL_APP_PASSWORD aren't
    // configured yet, logging a warning instead of throwing).
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[OTP:${purpose}] ${identifier} -> ${code}`);
    }
    await this.mail.sendOtpEmail(identifier, code);

    return { success: true };
  }

  async verifyOtp(identifier: string, code: string, name?: string, rememberMe = false, meta?: { ip?: string; userAgent?: string }, purpose: 'login' | 'verify_email' = 'login') {
    const isEmail = identifier.includes('@');
    const candidate = await this.prisma.otpCode.findFirst({
      where: { identifier, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!candidate || candidate.attempts >= 5) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const ok = await bcrypt.compare(code, candidate.codeHash);
    if (!ok) {
      await this.prisma.otpCode.update({ where: { id: candidate.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.prisma.otpCode.update({ where: { id: candidate.id }, data: { consumedAt: new Date() } });

    let user = await this.prisma.user.findFirst({ where: isEmail ? { email: identifier } : { phone: identifier } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { [isEmail ? 'email' : 'phone']: identifier, name, isEmailVerified: isEmail },
      });
    } else {
      const updates: { name?: string; isEmailVerified?: boolean } = {};
      if (name && name !== user.name) updates.name = name;
      // Signing up with a password sends a 'verify_email' code separately
      // from login's 'login' code — this is the one place that actually
      // flips isEmailVerified on, once that code is confirmed.
      if (purpose === 'verify_email' && !user.isEmailVerified) updates.isEmailVerified = true;
      if (Object.keys(updates).length) user = await this.prisma.user.update({ where: { id: user.id }, data: updates });
    }

    const tokens = await this.issueTokenPair(user.id, user.roleId ?? undefined, user.email ?? undefined, rememberMe, meta);
    await this.audit.log({ userId: user.id, action: purpose === 'verify_email' ? 'auth.verify_email' : 'auth.login_otp', ip: meta?.ip, userAgent: meta?.userAgent });

    return { user: { id: user.id, name: user.name, identifier }, ...tokens };
  }

  // ---- Password login ------------------------------------------------------

  async register(name: string, email: string, phone: string, password: string, extra?: { churchName?: string; age?: number }) {
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing) throw new BadRequestException('An account with this email or phone already exists');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: { name, email, phone, passwordHash, churchName: extra?.churchName, age: extra?.age },
    });
    await this.requestOtp(email, 'verify_email');
    return { success: true, userId: user.id };
  }

  async login(email: string, password: string, rememberMe = false, meta?: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Account disabled');

    const tokens = await this.issueTokenPair(user.id, user.roleId ?? undefined, user.email ?? undefined, rememberMe, meta);
    await this.audit.log({ userId: user.id, action: 'auth.login_password', ip: meta?.ip, userAgent: meta?.userAgent });
    return { user: { id: user.id, name: user.name, email: user.email }, ...tokens };
  }

  /**
   * Driver login (phone/email + password). Drivers are a separate `Driver`
   * table, not wired into `refresh_tokens`/`sessions` (those FK to `User`).
   * Rather than migrate the schema to give drivers first-class refresh-token
   * rotation, this issues one longer-lived (12h) access token — a driver
   * logs in once per shift and re-authenticates the next one. If drivers
   * need silent long-lived sessions (multi-day app installs) later, that's
   * the point to add a `driver_refresh_tokens` table mirroring the
   * user one, not to bend this table to fit.
   */
  async driverLogin(identifier: string, password: string, meta?: { ip?: string; userAgent?: string }) {
    const isEmail = identifier.includes('@');
    const driver = await this.prisma.driver.findFirst({ where: isEmail ? { email: identifier } : { phone: identifier } });
    if (!driver?.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, driver.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.jwt.sign(
      { sub: driver.id, role: 'driver' },
      { secret: getJwtAccessSecret(), expiresIn: '12h' },
    );
    await this.audit.log({ action: 'auth.driver_login', entityType: 'driver', entityId: driver.id, ip: meta?.ip, userAgent: meta?.userAgent });
    return { driver: { id: driver.id, name: driver.name }, accessToken };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always return success even if the user doesn't exist — don't leak
    // account existence via response timing/shape.
    if (user) await this.requestOtp(email, 'reset_password');
    return { success: true };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const candidate = await this.prisma.otpCode.findFirst({
      where: { identifier: email, purpose: 'reset_password', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!candidate) throw new BadRequestException('Invalid or expired code');
    const ok = await bcrypt.compare(code, candidate.codeHash);
    if (!ok) throw new BadRequestException('Invalid or expired code');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('Invalid or expired code');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.otpCode.update({ where: { id: candidate.id }, data: { consumedAt: new Date() } }),
      // Reset password -> revoke every existing session/refresh token on all devices.
      this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.mail.sendPasswordChangedEmail(email);

    return { success: true };
  }

  // ---- Google Sign-In ------------------------------------------------------

  /**
   * Verifies a Google ID token and logs the user in (creating an account on
   * first sign-in). Verification is done via a plain HTTPS call to Google's
   * own tokeninfo endpoint rather than the `google-auth-library` SDK —
   * deliberately, so this doesn't add a new npm dependency (one more thing
   * that could break a build) and uses the exact same "just an HTTPS fetch"
   * pattern already proven reliable on this host (see MailService/Resend).
   * Google's docs list this endpoint as fine for low/medium-volume
   * server-side verification: https://developers.google.com/identity/sign-in/web/backend-auth
   */
  async loginWithGoogle(idToken: string, rememberMe = false, meta?: { ip?: string; userAgent?: string }) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new BadRequestException('Google Sign-In is not configured on this server yet.');

    let payload: { aud?: string; email?: string; email_verified?: string; name?: string; sub?: string };
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!res.ok) throw new Error(`tokeninfo returned ${res.status}`);
      payload = await res.json();
    } catch (err) {
      throw new UnauthorizedException('Could not verify Google sign-in — please try again.');
    }

    if (payload.aud !== clientId) throw new UnauthorizedException('Google token was not issued for this app.');
    if (payload.email_verified !== 'true' || !payload.email) throw new UnauthorizedException('Google account email is not verified.');

    let user = await this.prisma.user.findUnique({ where: { email: payload.email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: payload.email, name: payload.name || payload.email.split('@')[0], isEmailVerified: true },
      });
    } else if (!user.isActive) {
      throw new UnauthorizedException('Account disabled');
    }

    const tokens = await this.issueTokenPair(user.id, user.roleId ?? undefined, user.email ?? undefined, rememberMe, meta);
    await this.audit.log({ userId: user.id, action: 'auth.login_google', ip: meta?.ip, userAgent: meta?.userAgent });
    return { user: { id: user.id, name: user.name, email: user.email }, ...tokens };
  }

  // ---- Token issuance / refresh rotation -----------------------------------

  private async issueTokenPair(userId: string, roleId: string | undefined, email: string | undefined, rememberMe: boolean, meta?: { ip?: string; userAgent?: string }) {
    const accessToken = this.jwt.sign(
      { sub: userId, roleId, email },
      { secret: getJwtAccessSecret(), expiresIn: ACCESS_TOKEN_TTL },
    );

    const rawRefresh = crypto.randomBytes(48).toString('hex');
    const days = rememberMe ? REFRESH_TOKEN_TTL_DAYS_DEFAULT : REFRESH_TOKEN_TTL_DAYS_SHORT;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(rawRefresh), expiresAt, deviceInfo: meta?.userAgent },
    });
    await this.prisma.session.create({
      data: { userId, deviceInfo: meta?.userAgent, ip: meta?.ip, rememberMe, expiresAt },
    });

    return { accessToken, refreshToken: rawRefresh, expiresAt };
  }

  /** Rotates a refresh token: old one is revoked, a new pair is issued. Reuse of a revoked token revokes the whole family (theft detection). */
  async refresh(rawRefreshToken: string, meta?: { ip?: string; userAgent?: string }) {
    const tokenHash = hashToken(rawRefreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record) throw new UnauthorizedException('Invalid refresh token');

    if (record.revokedAt) {
      // Reused a revoked token -> possible theft. Revoke every token for this user.
      await this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ userId: record.userId, action: 'auth.refresh_reuse_detected', ip: meta?.ip, userAgent: meta?.userAgent });
      throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
    }

    if (record.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Account unavailable');

    const rawNew = crypto.randomBytes(48).toString('hex');
    const newHash = hashToken(rawNew);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date(), replacedBy: newHash } }),
      this.prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: newHash, expiresAt: record.expiresAt, deviceInfo: meta?.userAgent },
      }),
    ]);

    const accessToken = this.jwt.sign(
      { sub: user.id, roleId: user.roleId, email: user.email },
      { secret: getJwtAccessSecret(), expiresIn: ACCESS_TOKEN_TTL },
    );

    return { accessToken, refreshToken: rawNew };
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    return { success: true };
  }

  /** Revoke every session/refresh token for a user — used by "log out of all devices". */
  async logoutAllDevices(userId: string) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { success: true };
  }
}

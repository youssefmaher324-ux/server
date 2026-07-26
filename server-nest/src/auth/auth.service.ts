import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { getJwtAccessSecret } from '../config/jwt.config';

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
  ) {}

  // ---- OTP ---------------------------------------------------------------

  async requestOtp(identifier: string, purpose: 'login' | 'verify_email' | 'reset_password' = 'login') {
    const isEmail = identifier.includes('@');
    const code = randomOtp();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const user = await this.prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { phone: identifier },
    });

    await this.prisma.otpCode.create({
      data: { userId: user?.id, identifier, codeHash, purpose, expiresAt },
    });

    // In production this dispatches via the notifications module (email/SMS
    // provider). Never log the raw code outside of local development.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[OTP:${purpose}] ${identifier} -> ${code}`);
    }

    return { success: true };
  }

  async verifyOtp(identifier: string, code: string, name?: string, rememberMe = false, meta?: { ip?: string; userAgent?: string }) {
    const isEmail = identifier.includes('@');
    const candidate = await this.prisma.otpCode.findFirst({
      where: { identifier, purpose: 'login', consumedAt: null, expiresAt: { gt: new Date() } },
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
    } else if (name && name !== user.name) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { name } });
    }

    const tokens = await this.issueTokenPair(user.id, user.roleId ?? undefined, user.email ?? undefined, rememberMe, meta);
    await this.audit.log({ userId: user.id, action: 'auth.login_otp', ip: meta?.ip, userAgent: meta?.userAgent });

    return { user: { id: user.id, name: user.name, identifier }, ...tokens };
  }

  // ---- Password login ------------------------------------------------------

  async register(name: string, email: string, phone: string, password: string) {
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing) throw new BadRequestException('An account with this email or phone already exists');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({ data: { name, email, phone, passwordHash } });
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

    return { success: true };
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

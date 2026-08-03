import { Body, Controller, Get, Post, Req, Res, UseGuards, Ip } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  RequestOtpDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto';

// The frontends (Vercel) and this API (Railway) are deliberately on
// different domains — that makes every request here a cross-site request
// from the browser's point of view. SameSite=Strict (or even Lax) makes
// the browser silently drop the cookie on cross-site requests entirely,
// regardless of `credentials: 'include'` on the frontend's fetch calls —
// this was causing every login to immediately look like a dead session.
// SameSite=None is required for a cross-domain cookie to be sent at all,
// and browsers require Secure=true whenever SameSite=None is used (only
// works over HTTPS, which both Vercel and Railway are in production).
const CROSS_SITE_COOKIES = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: CROSS_SITE_COOKIES,
  sameSite: (CROSS_SITE_COOKIES ? 'none' : 'lax') as 'none' | 'lax',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string, expiresAt?: Date) {
    res.cookie('access_token', accessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refreshToken, {
      ...COOKIE_OPTS,
      maxAge: expiresAt ? expiresAt.getTime() - Date.now() : 24 * 60 * 60 * 1000,
    });
  }

  // Only functional when ENABLE_CSRF=true (see main.ts) — that's the only
  // time the csurf middleware runs and req.csrfToken() exists. A same-origin
  // browser client must call this first and echo the token back as
  // `X-CSRF-Token` on every subsequent POST/PATCH/DELETE.
  @Get('csrf-token')
  csrfToken(@Req() req: Request) {
    if (process.env.ENABLE_CSRF !== 'true') {
      return { csrfEnabled: false, message: 'CSRF protection is disabled (ENABLE_CSRF is not "true")' };
    }
    return { csrfEnabled: true, csrfToken: (req as Request & { csrfToken: () => string }).csrfToken() };
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } }) // 10/hour/IP — brute force guard
  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.identifier, 'login');
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Ip() ip: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(dto.identifier, dto.code, dto.name, dto.rememberMe, {
      ip,
      userAgent: req.headers['user-agent'],
    });
    this.setAuthCookies(res, result.accessToken, result.refreshToken, result.expiresAt);
    return { success: true, user: result.user, accessToken: result.accessToken };
  }

  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @Post('google')
  async google(@Body() dto: { idToken: string; rememberMe?: boolean }, @Ip() ip: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.loginWithGoogle(dto.idToken, dto.rememberMe, { ip, userAgent: req.headers['user-agent'] });
    this.setAuthCookies(res, result.accessToken, result.refreshToken, result.expiresAt);
    return { success: true, user: result.user, accessToken: result.accessToken };
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.name, dto.email, dto.phone, dto.password, { churchName: dto.churchName, age: dto.age });
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password, dto.rememberMe, { ip, userAgent: req.headers['user-agent'] });
    this.setAuthCookies(res, result.accessToken, result.refreshToken, result.expiresAt);
    return { success: true, user: result.user, accessToken: result.accessToken };
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('driver-login')
  async driverLogin(
    @Body() dto: { identifier: string; password: string },
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.driverLogin(dto.identifier, dto.password, { ip, userAgent: req.headers['user-agent'] });
    // No refresh_token cookie — see AuthService.driverLogin for why drivers
    // only get a single longer-lived access token today.
    res.cookie('access_token', result.accessToken, { ...COOKIE_OPTS, maxAge: 12 * 60 * 60 * 1000 });
    return { success: true, driver: result.driver, accessToken: result.accessToken };
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = dto.refreshToken || req.cookies?.refresh_token;
    const result = await this.auth.refresh(raw, { ip: req.ip, userAgent: req.headers['user-agent'] });
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { success: true, accessToken: result.accessToken };
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.refresh_token;
    if (raw) await this.auth.logout(raw);
    res.clearCookie('access_token', COOKIE_OPTS);
    res.clearCookie('refresh_token', COOKIE_OPTS);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@Req() req: Request & { user: { userId: string } }) {
    return this.auth.logoutAllDevices(req.user.userId);
  }
}

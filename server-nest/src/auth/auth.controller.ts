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

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
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

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.name, dto.email, dto.phone, dto.password);
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

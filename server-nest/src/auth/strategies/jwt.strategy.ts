import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

function extractFromCookieOrHeader(req: Request): string | null {
  if (req?.cookies?.access_token) return req.cookies.access_token;
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: extractFromCookieOrHeader,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: { sub: string; roleId?: string; email?: string }) {
    // Attached to req.user by passport; kept minimal on purpose — anything
    // that changes often (role, permissions) is re-fetched fresh by guards
    // rather than trusted from an old token payload.
    return { userId: payload.sub, roleId: payload.roleId, email: payload.email };
  }
}

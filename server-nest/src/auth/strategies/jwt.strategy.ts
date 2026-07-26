import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { getJwtAccessSecret } from '../../config/jwt.config';

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
      secretOrKey: getJwtAccessSecret(),
    });
  }

  async validate(payload: { sub: string; roleId?: string; email?: string; role?: string }) {
    // Attached to req.user by passport; kept minimal on purpose — anything
    // that changes often (role, permissions) is re-fetched fresh by guards
    // rather than trusted from an old token payload.
    //
    // `role` (a literal string) is only present on driver tokens — drivers
    // are a separate table from User/Role, not wired into the RBAC
    // roles/permissions tables, so there's no roleId to look up. `roleId`
    // is present on normal User tokens instead; RolesGuard checks whichever
    // one is set.
    return { userId: payload.sub, roleId: payload.roleId, email: payload.email, role: payload.role };
  }
}

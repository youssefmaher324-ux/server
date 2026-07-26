import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { LegacyActionsService } from './legacy-actions.service';

/**
 * `accessKey`-based auth is gone. This now requires a real JWT from
 * POST /api/auth/login (email + password), the same as every other
 * protected route — see LegacyActionsService.dispatch for why the action
 * dispatcher itself is kept (it's the only place some staff-only bulk
 * operations like getStats/deleteAllOrders currently live).
 */
@ApiTags('legacy-compat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'employee', 'super_admin')
@Controller('citrine/actions')
export class LegacyActionsController {
  constructor(private legacy: LegacyActionsService) {}

  @Throttle({ default: { limit: 300, ttl: 900_000 } }) // matches old GENERAL_RATE_LIMIT_PER_15MIN
  @Post()
  async dispatch(@Body() body: { action: string } & Record<string, any>, @Req() req: Request & { user: { userId: string } }) {
    const { action, ...payload } = body;
    return this.legacy.dispatch(action, payload, req.user.userId, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }
}


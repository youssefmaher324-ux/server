import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { LegacyActionsService } from './legacy-actions.service';

@ApiTags('legacy-compat')
@Controller('citrine/actions')
export class LegacyActionsController {
  constructor(private legacy: LegacyActionsService) {}

  @Throttle({ default: { limit: 300, ttl: 900_000 } }) // matches old GENERAL_RATE_LIMIT_PER_15MIN
  @Post()
  async dispatch(@Body() body: { action: string } & Record<string, any>, @Req() req: Request) {
    const { action, ...payload } = body;
    return this.legacy.dispatch(action, payload, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }
}

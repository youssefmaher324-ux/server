import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma-health.indicator';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaIndicator: PrismaHealthIndicator,
  ) {}

  /**
   * Liveness — this is what Railway's healthcheckPath (railway.json) polls
   * during deploy. It intentionally does NOT depend on the database: if
   * Supabase is briefly unreachable or the connection pool is still warming
   * up, Railway would otherwise kill a perfectly healthy container and loop
   * on deploy forever (this is exactly the class of bug that caused the
   * earlier "1/1 replicas never became healthy" failure once the missing
   * dist/main.js issue was fixed — a DB-dependent healthcheck would have
   * just traded one failure mode for another). Always returns 200 once the
   * Nest process is up and able to handle HTTP requests.
   */
  @Get()
  liveness() {
    return {
      status: 'ok',
      service: 'citrine-backend',
      // Bump this string on every meaningful backend change. Lets anyone
      // confirm from a plain browser tab — no logs, no GitHub, no Railway
      // dashboard needed — whether a given deploy is actually the one
      // that's live yet.
      build: 'profile-page-password-signup-2026-07-31',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness — real dependency check (DB reachable). Use this for uptime
   * monitoring / manual checks, not as the Railway deploy gate.
   */
  @Get('db')
  @HealthCheck()
  db() {
    return this.health.check([() => this.prismaIndicator.pingCheck('database')]);
  }
}

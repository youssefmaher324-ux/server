import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

/**
 * @nestjs/terminus does not ship a built-in Prisma indicator (unlike
 * TypeOrmHealthIndicator/MongooseHealthIndicator) — the previous version of
 * this file imported `PrismaHealthIndicator` from '@nestjs/terminus', which
 * doesn't exist there and failed TypeScript compilation. This hand-rolls the
 * same pattern Terminus's own indicators use.
 */
@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private prisma: PrismaService) {
    super();
  }

  async pingCheck(key: string, timeoutMs = 3000): Promise<HealthIndicatorResult> {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database ping timed out')), timeoutMs)),
      ]);
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Prisma health check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}

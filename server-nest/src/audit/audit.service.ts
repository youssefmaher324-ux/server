import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    userId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }) {
    // Fire-and-forget by design: an audit-log failure must never fail the
    // request it's describing. Errors are swallowed here and should be
    // shipped to Sentry in production.
    try {
      await this.prisma.auditLog.create({ data: params });
    } catch {
      /* noop */
    }
  }
}

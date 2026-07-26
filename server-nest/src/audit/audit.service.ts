import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    // Built explicitly (rather than passing `params` straight through) so
    // the shape matches Prisma's generated AuditLogUncheckedCreateInput:
    // - userId is a scalar FK here (unchecked input), typed string | undefined,
    //   never `null` — omit the key entirely when there's no user instead of
    //   assigning null/undefined to it.
    // - metadata must be a valid Prisma.InputJsonValue (unknown isn't
    //   assignable to that), so it's round-tripped through JSON to guarantee
    //   a plain JSON-safe value, and only included when present.
    const data: Prisma.AuditLogUncheckedCreateInput = {
      action: params.action,
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.entityType ? { entityType: params.entityType } : {}),
      ...(params.entityId ? { entityId: params.entityId } : {}),
      ...(params.ip ? { ip: params.ip } : {}),
      ...(params.userAgent ? { userAgent: params.userAgent } : {}),
      ...(params.metadata ? { metadata: JSON.parse(JSON.stringify(params.metadata)) as Prisma.InputJsonValue } : {}),
    };

    // Fire-and-forget by design: an audit-log failure must never fail the
    // request it's describing. Errors are swallowed here and should be
    // shipped to Sentry in production.
    try {
      await this.prisma.auditLog.create({ data });
    } catch {
      /* noop */
    }
  }
}


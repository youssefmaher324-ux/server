import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'query'],
    });
  }

  async onModuleInit() {
    // Deliberately NOT `await`-ing a failure into a thrown error here.
    // If $connect() rejects (bad DATABASE_URL, Supabase project paused,
    // transient network/SSL issue), letting that propagate kills
    // NestFactory.create() itself — the process exits before app.listen()
    // ever runs, so even the DB-independent /api/health liveness check
    // never gets a chance to respond. Railway then sees "service
    // unavailable" on every healthcheck retry and fails the whole deploy,
    // even though the actual problem might be a temporary DB blip.
    //
    // Prisma Client connects lazily on its first real query by default —
    // this eager connect is just a startup warm-up. If it fails, we log
    // it loudly and let the HTTP server come up anyway: /api/health still
    // returns 200 (liveness), /api/health/db will correctly report the DB
    // as down (readiness), and any DB-touching route will surface a clear
    // Prisma error on its own instead of taking the whole app down with it.
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error(
        `Could not connect to the database at startup — the app will still start, but DB-dependent routes will fail until this is fixed. ` +
          `Check DATABASE_URL and that the Supabase project is not paused. Error: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Wraps a set of operations in a single DB transaction. */
  async runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn);
  }
}


import 'reflect-metadata';
import 'dotenv/config';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import csurf from 'csurf';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { validateEnv } from './config/validate-env';

async function bootstrap() {
  validateEnv();

  if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Railway (like Heroku/most PaaS) terminates TLS at its edge and forwards
  // plain HTTP to the container behind a proxy. Without `trust proxy`,
  // Express sees every request as coming from the proxy's internal IP —
  // which silently breaks per-IP rate limiting (ThrottlerGuard) and audit
  // log IPs (every request would share one bucket/IP) even though nothing
  // throws an error. This makes req.ip / X-Forwarded-For resolve correctly.
  app.set('trust proxy', 1);

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, '').replace(/\/$/, '')) // strip stray quotes (a common copy-paste mistake when setting this in Railway's UI) + trailing slash
    .filter(Boolean);

  const isOriginAllowed = (origin: string | undefined): boolean => {
    if (!origin) return true; // same-origin / curl / server-to-server — no Origin header at all
    if (!allowedOrigins.length) return true; // ALLOWED_ORIGINS unset -> dev fallback, allow all
    const normalized = origin.replace(/\/$/, '');
    return allowedOrigins.some((o) => o.toLowerCase() === normalized.toLowerCase());
  };

  // ---------------------------------------------------------------------
  // CORS AUDIT — explicit preflight short-circuit (registered before
  // EVERYTHING else, including helmet/cookieParser/csurf).
  //
  // app.enableCors() below is Nest's normal, correct way to do this, and on
  // its own is sufficient in the overwhelming majority of setups. This raw
  // handler is deliberate belt-and-suspenders on top of it, added because:
  //
  //  1. It guarantees OPTIONS is answered by the very first middleware in
  //     the stack, with zero dependency on Nest's routing/guards/pipes ever
  //     running — so a future global guard, interceptor, or filter added
  //     anywhere in the app can NEVER accidentally intercept or delay a
  //     preflight response again.
  //  2. It logs any rejected Origin to the server logs, which
  //     app.enableCors() does not do by default — makes a future
  //     ALLOWED_ORIGINS mismatch (trailing slash, wrong scheme, stale
  //     Vercel preview URL) immediately visible in Railway logs instead of
  //     only failing silently in the browser as "Failed to fetch".
  // ---------------------------------------------------------------------
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin as string | undefined;
    const allowed = isOriginAllowed(origin);

    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (origin && !allowed) {
      // eslint-disable-next-line no-console
      console.warn(`[CORS] Rejected Origin "${origin}" — not in ALLOWED_ORIGINS (${allowedOrigins.join(', ') || '(empty)'})`);
    }

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        (req.headers['access-control-request-headers'] as string) || 'Content-Type, Authorization, X-CSRF-Token',
      );
      res.setHeader('Access-Control-Max-Age', '86400'); // cache preflight 24h — fewer round-trips
      return res.sendStatus(204);
    }

    next();
  });

  // Nest's own CORS handling — kept as the primary mechanism for real
  // (non-OPTIONS) responses. Custom origin function matches the same
  // normalized/case-insensitive logic as the raw handler above, and logs
  // rejections the same way, so both layers agree with each other.
  app.enableCors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) return callback(null, true);
      console.warn(`[CORS] Rejected Origin "${origin}" — not in ALLOWED_ORIGINS (${allowedOrigins.join(', ') || '(empty)'})`);
      return callback(null, false);
    },
    credentials: true,
  });

  app.use(
    helmet({
      // Default (v7) sets Cross-Origin-Resource-Policy: same-origin, which
      // makes browsers block the RESPONSE body of a successful cross-origin
      // fetch even when the CORS headers above are completely correct —
      // this API is deliberately called from separate-origin static sites
      // (customer/employee/admin/delivery), so it must opt out of that.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Same story for COOP — 'same-origin' (the v7 default) is meant for
      // apps that open popups/windows to their own origin; it isn't needed
      // here and has caused false-positive fetch blocking in some browsers
      // when combined with credentialed cross-origin requests.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );
  app.use(cookieParser());

  // CSRF protection (double-submit cookie pattern via `csurf`).
  //
  // Defaults OFF. This API is consumed by separate-origin static sites
  // (customer/employee/admin/delivery) and Bearer-token clients, not
  // same-origin browser form posts — the classic case `csurf` protects
  // against. Turning it on WITHOUT a client that first fetches
  // GET /api/auth/csrf-token and echoes it back as `X-CSRF-Token` on every
  // mutating request will make every POST/PATCH/DELETE fail with 403,
  // including login itself. Set ENABLE_CSRF=true only once a same-origin,
  // cookie-authenticated browser client fetches that token first.
  if (process.env.ENABLE_CSRF === 'true') {
    app.use(
      csurf({
        cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' },
      }),
    );
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown fields -> defends against mass-assignment
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api', { exclude: [] });

  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Monastery Guesthouse API')
      .setDescription('Auth (OTP), rooms, bookings, news, RBAC')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT) || 4000;
  // Bind explicitly to 0.0.0.0 — Railway's container networking expects the
  // process to listen on all interfaces, not just localhost/loopback.
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🚀 Monastery Guesthouse API running on port ${port}`);
}

bootstrap();

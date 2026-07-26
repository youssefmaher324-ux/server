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
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  });

  app.use(helmet());
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
      .setTitle('Citrine Juice Co. API')
      .setDescription('Products, orders, coupons, drivers, auth')
      .setVersion('3.0')
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
  console.log(`🚀 Citrine API running on port ${port}`);
}

bootstrap();

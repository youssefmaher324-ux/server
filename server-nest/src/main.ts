import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import csurf from 'csurf';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

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

  // CSRF protection for cookie-based sessions (double-submit pattern).
  // Only enforced on state-changing requests carrying a session cookie;
  // stateless Bearer-token API calls (mobile/JSON clients) are unaffected
  // because they don't send the csrf cookie in the first place.
  if (process.env.ENABLE_CSRF !== 'false') {
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

  app.setGlobalPrefix('api');

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

  const port = process.env.PORT || 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 Citrine API running on port ${port}`);
}

bootstrap();

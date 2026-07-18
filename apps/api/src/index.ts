import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { authConfig } from './config/auth.config';
import { applySafeBodyParser } from './http/safe-body-parser';
import { applyTrustProxy } from './http/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false
  });
  applyTrustProxy(app, authConfig);
  applySafeBodyParser(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  await app.listen(4000, '0.0.0.0');
}

void bootstrap();

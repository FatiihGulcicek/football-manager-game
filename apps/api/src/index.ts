import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { authConfig } from './config/auth.config';
import { applyTrustProxy } from './http/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  applyTrustProxy(app, authConfig);
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

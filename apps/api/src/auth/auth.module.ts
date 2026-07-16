import { Module } from '@nestjs/common';
import { AUTH_CONFIG, authConfig } from '../config/auth.config';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './controllers/auth.controller';
import { AccessTokenService } from './services/access-token.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { RegisterRateLimitService } from './services/register-rate-limit.service';
import { RegisterService } from './services/register.service';
import { SessionService } from './services/session.service';
import { TokenHashService } from './services/token-hash.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_CONFIG,
      useValue: authConfig
    },
    PasswordService,
    TokenHashService,
    AccessTokenService,
    SessionService,
    RefreshTokenService,
    RegisterRateLimitService,
    RegisterService
  ],
  exports: [
    PasswordService,
    TokenHashService,
    AccessTokenService,
    SessionService,
    RefreshTokenService,
    RegisterRateLimitService,
    RegisterService
  ]
})
export class AuthModule {}

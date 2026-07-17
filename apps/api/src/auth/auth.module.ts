import { Module } from '@nestjs/common';
import { AUTH_CONFIG, authConfig } from '../config/auth.config';
import { DatabaseModule } from '../database/database.module';
import { AuthSessionsController } from './controllers/auth-sessions.controller';
import { AuthController } from './controllers/auth.controller';
import { AccessTokenGuard } from './guards/access-token.guard';
import { AccessTokenService } from './services/access-token.service';
import { EmailVerificationRateLimitService } from './services/email-verification-rate-limit.service';
import { EmailVerificationService } from './services/email-verification.service';
import { LoginRateLimitService } from './services/login-rate-limit.service';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { PasswordService } from './services/password.service';
import { RefreshRateLimitService } from './services/refresh-rate-limit.service';
import { RefreshService } from './services/refresh.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { RegisterRateLimitService } from './services/register-rate-limit.service';
import { RegisterService } from './services/register.service';
import { SessionManagementService } from './services/session-management.service';
import { SessionService } from './services/session.service';
import { TokenHashService } from './services/token-hash.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController, AuthSessionsController],
  providers: [
    {
      provide: AUTH_CONFIG,
      useValue: authConfig
    },
    AccessTokenGuard,
    PasswordService,
    TokenHashService,
    AccessTokenService,
    EmailVerificationRateLimitService,
    EmailVerificationService,
    SessionService,
    SessionManagementService,
    RefreshTokenService,
    RefreshRateLimitService,
    RefreshService,
    LogoutService,
    LoginRateLimitService,
    LoginService,
    RegisterRateLimitService,
    RegisterService
  ],
  exports: [
    PasswordService,
    TokenHashService,
    AccessTokenService,
    AccessTokenGuard,
    EmailVerificationRateLimitService,
    EmailVerificationService,
    SessionService,
    SessionManagementService,
    RefreshTokenService,
    RefreshRateLimitService,
    RefreshService,
    LogoutService,
    LoginRateLimitService,
    LoginService,
    RegisterRateLimitService,
    RegisterService
  ]
})
export class AuthModule {}

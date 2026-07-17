import { Module } from '@nestjs/common';
import { AUTH_CONFIG, authConfig } from '../config/auth.config';
import { DatabaseModule } from '../database/database.module';
import { AuthSessionsController } from './controllers/auth-sessions.controller';
import { AuthController } from './controllers/auth.controller';
import { AccessTokenGuard } from './guards/access-token.guard';
import { AccessTokenService } from './services/access-token.service';
import {
  EMAIL_VERIFICATION_DELIVERY_SERVICE,
  NoopEmailVerificationDeliveryService
} from './services/email-verification-delivery.service';
import { EmailVerificationResendRateLimitService } from './services/email-verification-resend-rate-limit.service';
import { EmailVerificationResendService } from './services/email-verification-resend.service';
import { EmailVerificationRateLimitService } from './services/email-verification-rate-limit.service';
import { EmailVerificationService } from './services/email-verification.service';
import { ForgotPasswordService } from './services/forgot-password.service';
import { LoginRateLimitService } from './services/login-rate-limit.service';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { PasswordService } from './services/password.service';
import {
  NoopPasswordResetDeliveryService,
  PASSWORD_RESET_DELIVERY_SERVICE
} from './services/password-reset-delivery.service';
import { PasswordResetRateLimitService } from './services/password-reset-rate-limit.service';
import { RefreshRateLimitService } from './services/refresh-rate-limit.service';
import { RefreshService } from './services/refresh.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { RegisterRateLimitService } from './services/register-rate-limit.service';
import { RegisterService } from './services/register.service';
import { ResetPasswordService } from './services/reset-password.service';
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
    {
      provide: EMAIL_VERIFICATION_DELIVERY_SERVICE,
      useClass: NoopEmailVerificationDeliveryService
    },
    EmailVerificationRateLimitService,
    EmailVerificationService,
    EmailVerificationResendRateLimitService,
    EmailVerificationResendService,
    {
      provide: PASSWORD_RESET_DELIVERY_SERVICE,
      useClass: NoopPasswordResetDeliveryService
    },
    PasswordResetRateLimitService,
    ForgotPasswordService,
    ResetPasswordService,
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
    EMAIL_VERIFICATION_DELIVERY_SERVICE,
    EmailVerificationRateLimitService,
    EmailVerificationService,
    EmailVerificationResendRateLimitService,
    EmailVerificationResendService,
    PASSWORD_RESET_DELIVERY_SERVICE,
    PasswordResetRateLimitService,
    ForgotPasswordService,
    ResetPasswordService,
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

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import {
  AUTH_RATE_LIMITED_CODE,
  AUTH_RATE_LIMITED_MESSAGE,
  AuthRateLimitExceededException
} from '../errors/auth-rate-limit-exceeded.exception';
import { EmailVerificationResendService } from '../services/email-verification-resend.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { ForgotPasswordService } from '../services/forgot-password.service';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshService } from '../services/refresh.service';
import { RegisterService } from '../services/register.service';
import { ResetPasswordService } from '../services/reset-password.service';
import { AuthController } from './auth.controller';

const config: AuthConfig = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
  emailVerifyTtlSeconds: 86_400,
  passwordResetTtlSeconds: 1_800,
  refreshGraceSeconds: 5,
  jwtIssuer: 'football-manager-auth',
  jwtAudience: 'football-manager-api',
  jwtActiveKid: 'test',
  jwtPrivateKey: 'unused',
  jwtPublicKeys: { test: 'unused' },
  tokenPepper: 'test-pepper',
  cookieName: 'refresh_token',
  cookieSecure: false,
  cookieSameSite: 'lax',
  cookiePath: '/',
  trustProxyCidrs: [],
  argon2MemoryCost: 1_024,
  argon2TimeCost: 2,
  argon2Parallelism: 1
};

describe('AuthController rate limit responses', () => {
  let app: INestApplication;
  let services: ReturnType<typeof createServiceMocks>;

  beforeEach(async () => {
    services = createServiceMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: config },
        { provide: RegisterService, useValue: services.registerService },
        { provide: LoginService, useValue: services.loginService },
        { provide: RefreshService, useValue: services.refreshService },
        { provide: LogoutService, useValue: services.logoutService },
        { provide: EmailVerificationService, useValue: services.emailVerificationService },
        {
          provide: EmailVerificationResendService,
          useValue: services.emailVerificationResendService
        },
        { provide: ForgotPasswordService, useValue: services.forgotPasswordService },
        { provide: ResetPasswordService, useValue: services.resetPasswordService }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true
      })
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    {
      name: 'register',
      method: () => services.registerService.register,
      request: () =>
        request(app.getHttpServer()).post('/auth/register').send({
          email: 'rate@example.invalid',
          password: 'TestOnlyPass123',
          displayName: 'Rate Limited'
        })
    },
    {
      name: 'login',
      method: () => services.loginService.login,
      request: () =>
        request(app.getHttpServer()).post('/auth/login').send({
          email: 'rate@example.invalid',
          password: 'TestOnlyPass123'
        })
    },
    {
      name: 'refresh',
      method: () => services.refreshService.refresh,
      request: () =>
        request(app.getHttpServer())
          .post('/auth/refresh')
          .set('Cookie', 'refresh_token=raw-cookie-value')
          .send({})
    },
    {
      name: 'verify-email',
      method: () => services.emailVerificationService.verifyEmail,
      request: () =>
        request(app.getHttpServer()).post('/auth/verify-email').send({
          token: 'verify-token-input-01234567890123456789'
        })
    },
    {
      name: 'resend-verification',
      method: () => services.emailVerificationResendService.resendVerification,
      request: () =>
        request(app.getHttpServer()).post('/auth/resend-verification').send({
          email: 'rate@example.invalid'
        })
    },
    {
      name: 'forgot-password',
      method: () => services.forgotPasswordService.forgotPassword,
      request: () =>
        request(app.getHttpServer()).post('/auth/forgot-password').send({
          email: 'rate@example.invalid'
        })
    },
    {
      name: 'reset-password',
      method: () => services.resetPasswordService.resetPassword,
      request: () =>
        request(app.getHttpServer()).post('/auth/reset-password').send({
          token: 'reset-token-input-01234567890123456789',
          newPassword: 'NewPassword123'
        })
    }
  ])('should return a standard 429 envelope for $name', async ({ method, request: makeRequest }) => {
    method().mockRejectedValueOnce(new AuthRateLimitExceededException('req-rate-limit', 37));

    const response = await makeRequest()
      .set('X-Request-Id', 'req-rate-limit')
      .expect(429);

    expect(response.headers['retry-after']).toBe('37');
    expect(response.body).toEqual({
      error: {
        code: AUTH_RATE_LIMITED_CODE,
        message: AUTH_RATE_LIMITED_MESSAGE,
        requestId: 'req-rate-limit'
      }
    });
    expect(readSetCookie(response)).toHaveLength(0);
    expectResponseNotToLeakRateLimitInputs(response);
  });
});

function createServiceMocks() {
  return {
    registerService: { register: vi.fn() },
    loginService: { login: vi.fn() },
    refreshService: { refresh: vi.fn() },
    logoutService: { logout: vi.fn() },
    emailVerificationService: { verifyEmail: vi.fn() },
    emailVerificationResendService: { resendVerification: vi.fn() },
    forgotPasswordService: { forgotPassword: vi.fn() },
    resetPasswordService: { resetPassword: vi.fn() }
  };
}

function readSetCookie(response: { headers: Record<string, string | string[] | undefined> }): string[] {
  const header = response.headers['set-cookie'];

  if (Array.isArray(header)) {
    return header;
  }

  return header ? [header] : [];
}

function expectResponseNotToLeakRateLimitInputs(response: { body: unknown }): void {
  const serializedBody = JSON.stringify(response.body);

  expect(serializedBody).not.toContain('raw-cookie-value');
  expect(serializedBody).not.toContain('rate@example.invalid');
  expect(serializedBody).not.toContain('TestOnlyPass123');
  expect(serializedBody).not.toContain('verify-token-input');
  expect(serializedBody).not.toContain('reset-token-input');
  expect(serializedBody).not.toContain('Prisma');
  expect(serializedBody).not.toContain('database');
  expect(serializedBody).not.toContain('count');
}

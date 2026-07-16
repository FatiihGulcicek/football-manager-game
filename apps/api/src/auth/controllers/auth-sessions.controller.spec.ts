import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@football-manager/database';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import {
  AUTH_LOGOUT_ALL_INVALID_BODY_CODE,
  AUTH_LOGOUT_ALL_INVALID_BODY_MESSAGE
} from '../errors/auth-logout-all-invalid-body.exception';
import {
  AUTH_SESSION_REVOKE_INVALID_BODY_CODE,
  AUTH_SESSION_REVOKE_INVALID_BODY_MESSAGE
} from '../errors/auth-session-revoke-invalid-body.exception';
import { AuthSessionNotFoundException } from '../errors/auth-session-not-found.exception';
import { AccessTokenGuard } from '../guards/access-token.guard';
import { SessionsResponseDto } from '../dto/session.dto';
import { AccessTokenService } from '../services/access-token.service';
import { SessionManagementService } from '../services/session-management.service';
import { SessionService } from '../services/session.service';
import { AuthSessionsController } from './auth-sessions.controller';

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

describe('AuthSessionsController', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('should list only authenticated user sessions', async () => {
    const sessionManagementService = createSessionManagementService();
    sessionManagementService.listSessions.mockResolvedValue({
      sessions: [
        {
          id: 'session-current',
          deviceName: 'Windows Chrome',
          deviceType: 'DESKTOP',
          browser: 'Chrome',
          operatingSystem: 'Windows',
          countryCode: 'TR',
          city: 'Samsun',
          lastSeenAt: '2026-01-02T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-02-01T00:00:00.000Z',
          isCurrent: true
        }
      ]
    });
    app = await createSessionsApplication(sessionManagementService);

    const response = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set('Authorization', 'Bearer access-token-fixture')
      .expect(200);

    expect(response.body.sessions).toHaveLength(1);
    expect(response.body.sessions[0]).toMatchObject({
      id: 'session-current',
      isCurrent: true
    });
    expect(JSON.stringify(response.body)).not.toContain('tokenFamilyId');
    expect(JSON.stringify(response.body)).not.toContain('ipHash');
    expect(JSON.stringify(response.body)).not.toContain('userAgentHash');
    expect(JSON.stringify(response.body)).not.toContain('refreshToken');
    expect(sessionManagementService.listSessions).toHaveBeenCalledWith({
      userId: 'user-1',
      role: UserRole.USER,
      sessionId: 'session-current'
    });
  });

  it('should return 401 for unauthenticated session listing', async () => {
    app = await createSessionsApplication(createSessionManagementService());

    const response = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set('X-Request-Id', 'req-sessions-unauth')
      .expect(401);

    expect(response.body.error).toEqual({
      code: 'AUTH_UNAUTHORIZED',
      message: 'Oturum geçersiz veya süresi dolmuş.',
      requestId: 'req-sessions-unauth'
    });
  });

  it('should logout all sessions, clear refresh cookie, and return 204', async () => {
    const sessionManagementService = createSessionManagementService();
    app = await createSessionsApplication(sessionManagementService);

    const response = await request(app.getHttpServer())
      .post('/auth/logout-all')
      .set('Authorization', 'Bearer access-token-fixture')
      .set('Cookie', `${config.cookieName}=refresh-cookie-fixture`)
      .send({})
      .expect(204);

    expect(response.text).toBe('');
    expect(readSetCookie(response)[0]).toContain('refresh_token=');
    expect(readSetCookie(response)[0]).toContain('Expires=Thu, 01 Jan 1970');
    expect(sessionManagementService.logoutAll).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        role: UserRole.USER,
        sessionId: 'session-current'
      },
      expect.objectContaining({
        requestId: expect.any(String)
      })
    );
  });

  it('should reject logout-all request bodies with the standard auth envelope', async () => {
    const sessionManagementService = createSessionManagementService();
    app = await createSessionsApplication(sessionManagementService);

    const response = await request(app.getHttpServer())
      .post('/auth/logout-all')
      .set('Authorization', 'Bearer access-token-fixture')
      .set('X-Request-Id', 'req-logout-all-body')
      .send({
        refreshToken: 'body-token-should-not-leak'
      })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: AUTH_LOGOUT_ALL_INVALID_BODY_CODE,
        message: AUTH_LOGOUT_ALL_INVALID_BODY_MESSAGE,
        requestId: 'req-logout-all-body'
      }
    });
    expect(JSON.stringify(response.body)).not.toContain('body-token-should-not-leak');
    expect(sessionManagementService.logoutAll).not.toHaveBeenCalled();
  });

  it('should revoke another session without clearing the current refresh cookie', async () => {
    const sessionManagementService = createSessionManagementService();
    sessionManagementService.revokeSession.mockResolvedValue({ isCurrent: false });
    app = await createSessionsApplication(sessionManagementService);

    const response = await request(app.getHttpServer())
      .delete('/auth/sessions/session-other')
      .set('Authorization', 'Bearer access-token-fixture')
      .send({})
      .expect(204);

    expect(response.text).toBe('');
    expect(readSetCookie(response)).toHaveLength(0);
    expect(sessionManagementService.revokeSession).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        role: UserRole.USER,
        sessionId: 'session-current'
      },
      'session-other',
      expect.objectContaining({
        requestId: expect.any(String)
      })
    );
  });

  it('should allow current session revoke and clear the refresh cookie', async () => {
    const sessionManagementService = createSessionManagementService();
    sessionManagementService.revokeSession.mockResolvedValue({ isCurrent: true });
    app = await createSessionsApplication(sessionManagementService);

    const response = await request(app.getHttpServer())
      .delete('/auth/sessions/session-current')
      .set('Authorization', 'Bearer access-token-fixture')
      .set('Cookie', `${config.cookieName}=refresh-cookie-fixture`)
      .send({})
      .expect(204);

    expect(response.text).toBe('');
    expect(readSetCookie(response)[0]).toContain('refresh_token=');
    expect(readSetCookie(response)[0]).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('should hide another user session existence behind a 404 envelope', async () => {
    const sessionManagementService = createSessionManagementService();
    sessionManagementService.revokeSession.mockRejectedValue(new AuthSessionNotFoundException('req-idor'));
    app = await createSessionsApplication(sessionManagementService);

    const response = await request(app.getHttpServer())
      .delete('/auth/sessions/session-b')
      .set('Authorization', 'Bearer access-token-fixture')
      .set('X-Request-Id', 'req-idor')
      .send({})
      .expect(404);

    expect(response.body.error).toEqual({
      code: 'AUTH_SESSION_NOT_FOUND',
      message: 'Oturum bulunamadı.',
      requestId: 'req-idor'
    });
  });

  it('should reject session revoke bodies with the standard auth envelope', async () => {
    const sessionManagementService = createSessionManagementService();
    app = await createSessionsApplication(sessionManagementService);

    const response = await request(app.getHttpServer())
      .delete('/auth/sessions/session-other')
      .set('Authorization', 'Bearer access-token-fixture')
      .set('X-Request-Id', 'req-revoke-body')
      .send({
        rawToken: 'raw-token-should-not-leak'
      })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: AUTH_SESSION_REVOKE_INVALID_BODY_CODE,
        message: AUTH_SESSION_REVOKE_INVALID_BODY_MESSAGE,
        requestId: 'req-revoke-body'
      }
    });
    expect(JSON.stringify(response.body)).not.toContain('raw-token-should-not-leak');
    expect(sessionManagementService.revokeSession).not.toHaveBeenCalled();
  });
});

async function createSessionsApplication(
  sessionManagementService: ReturnType<typeof createSessionManagementService>
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthSessionsController],
    providers: [
      AccessTokenGuard,
      {
        provide: AUTH_CONFIG,
        useValue: config
      },
      {
        provide: SessionManagementService,
        useValue: sessionManagementService
      },
      {
        provide: AccessTokenService,
        useValue: {
          verifyAccessToken: vi.fn(() => ({
            userId: 'user-1',
            role: UserRole.USER,
            sessionId: 'session-current',
            issuedAtSeconds: 1,
            expiresAtSeconds: 2,
            keyId: 'test'
          }))
        }
      },
      {
        provide: SessionService,
        useValue: {
          assertSessionActive: vi.fn(async () => undefined),
          getActiveSession: vi.fn(async () => ({
            id: 'session-current',
            userId: 'user-1',
            userRole: UserRole.USER,
            expiresAt: new Date('2027-01-01T00:00:00.000Z')
          }))
        }
      }
    ]
  }).compile();
  const nestApp = moduleRef.createNestApplication();
  nestApp.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  await nestApp.init();

  return nestApp;
}

function createSessionManagementService() {
  return {
    listSessions: vi.fn(async (): Promise<SessionsResponseDto> => ({ sessions: [] })),
    logoutAll: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => ({ isCurrent: false }))
  };
}

function readSetCookie(response: { headers: Record<string, string | string[] | undefined> }): string[] {
  const header = response.headers['set-cookie'];

  if (Array.isArray(header)) {
    return header;
  }

  return header ? [header] : [];
}

import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@football-manager/database';
import { createHash } from 'crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { AccessTokenService } from '../services/access-token.service';
import { EmailVerificationService } from '../services/email-verification.service';
import {
  AUTH_REFRESH_INVALID_BODY_CODE,
  AUTH_REFRESH_INVALID_BODY_MESSAGE
} from '../errors/auth-refresh-invalid-body.exception';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshRateLimitService } from '../services/refresh-rate-limit.service';
import { RefreshService } from '../services/refresh.service';
import { RefreshTokenService } from '../services/refresh-token.service';
import { RegisterService } from '../services/register.service';
import { SessionService } from '../services/session.service';
import { TokenHashService } from '../services/token-hash.service';
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

const productionCookieConfig: AuthConfig = {
  ...config,
  cookieName: '__Host-refresh_token',
  cookieSecure: true,
  cookieSameSite: 'lax',
  cookiePath: '/'
};

describe('AuthController refresh', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('should continue refresh flow with an empty body, issue a new access token, and overwrite the cookie', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database, {
      userRole: UserRole.ADMIN
    });
    app = await createAuthRefreshApplication(database, config);

    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${config.cookieName}=parent-refresh-token`)
      .send({})
      .expect(200);
    const childToken = database.refreshTokens.find((token) => token.parentTokenId === 'token-1');

    expect(response.body).toEqual({
      accessToken: 'access-token:ADMIN:session-1',
      tokenType: 'Bearer',
      expiresIn: 900
    });
    expect(JSON.stringify(response.body)).not.toContain('rotated-refresh');
    expect(readSetCookie(response)[0]).toContain('refresh_token=rotated-refresh-1');
    expect(readSetCookie(response)[0]).toContain('HttpOnly');
    expect(readSetCookie(response)[0]).toContain('SameSite=Lax');
    expect(database.refreshTokens[0].usedAt).toBeInstanceOf(Date);
    expect(childToken).toMatchObject({
      sessionId: 'session-1',
      parentTokenId: 'token-1',
      usedAt: null,
      revokedAt: null
    });
    expect(childToken?.tokenHash).not.toContain('rotated-refresh-1');
    expect(database.userSessions[0].lastSeenAt.getTime()).toBeGreaterThan(
      new Date('2026-01-01T00:00:00.000Z').getTime()
    );
    expect(database.loginAttempts).toHaveLength(0);
    expect(database.auditLogs).toContainEqual(
      expect.objectContaining({
        action: AUTH_AUDIT_EVENTS.REFRESH_SUCCEEDED,
        entityType: 'UserSession',
        entityId: 'session-1',
        metadata: {
          context: 'REFRESH',
          reason: 'success',
          sessionId: 'session-1'
        }
      })
    );
  });

  it('should return conflict for an immediate second use of the same parent token', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database);
    app = await createAuthRefreshApplication(database, config);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${config.cookieName}=parent-refresh-token`)
      .send({})
      .expect(200);
    const conflictResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${config.cookieName}=parent-refresh-token`)
      .send({})
      .expect(409);

    expect(conflictResponse.body.error.code).toBe('AUTH_REFRESH_CONFLICT');
    expect(readSetCookie(conflictResponse)).toHaveLength(0);
    expect(database.userSessions[0].revokedAt).toBeNull();
    expect(database.refreshTokens.filter((token) => token.parentTokenId === 'token-1')).toHaveLength(1);
  });

  it('should revoke the session and token family for replay outside the grace window', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database, {
      tokenUsedAt: new Date(Date.now() - 10_000)
    });
    app = await createAuthRefreshApplication(database, config);

    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${config.cookieName}=parent-refresh-token`)
      .send({})
      .expect(401);

    expect(response.body.error.code).toBe('AUTH_REFRESH_REUSED');
    expect(readSetCookie(response)[0]).toContain('refresh_token=');
    expect(database.userSessions[0]).toMatchObject({
      revokedAt: expect.any(Date),
      revokeReason: 'refresh_reused'
    });
    expect(database.refreshTokens.every((token) => token.revokedAt instanceof Date)).toBe(true);
    expect(database.auditLogs).toContainEqual(
      expect.objectContaining({
        action: AUTH_AUDIT_EVENTS.REFRESH_REUSED,
        entityId: 'session-1'
      })
    );
  });

  it('should reject missing cookie and header-supplied refresh tokens', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database);
    app = await createAuthRefreshApplication(database, config);

    const missingCookie = await request(app.getHttpServer()).post('/auth/refresh').send({}).expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('X-Refresh-Token', 'parent-refresh-token')
      .send({})
      .expect(401);

    expect(missingCookie.body.error.code).toBe('AUTH_REFRESH_INVALID');
    expect(readSetCookie(missingCookie)).toHaveLength(0);
    expect(database.refreshTokens[0].usedAt).toBeNull();
  });

  it('should reject a refreshToken request body with the standard auth error envelope', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database);
    app = await createAuthRefreshApplication(database, config);

    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('X-Request-Id', 'req-invalid-body-token')
      .set('Cookie', `${config.cookieName}=parent-refresh-token`)
      .send({
        refreshToken: 'parent-refresh-token'
      })
      .expect(400);

    expectInvalidBodyEnvelope(response, 'req-invalid-body-token');
    expect(database.refreshTokens[0].usedAt).toBeNull();
  });

  it('should reject arbitrary, nested, and array request bodies with the standard auth error envelope', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database);
    app = await createAuthRefreshApplication(database, config);

    const cases: Array<{ requestId: string; body: object }> = [
      {
        requestId: 'req-invalid-body-field',
        body: { unexpected: 'field-value' }
      },
      {
        requestId: 'req-invalid-body-nested',
        body: { nested: { refreshToken: 'parent-refresh-token', cookie: 'refresh_token=parent-refresh-token' } }
      },
      {
        requestId: 'req-invalid-body-array',
        body: ['parent-refresh-token']
      }
    ];

    for (const bodyCase of cases) {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('X-Request-Id', bodyCase.requestId)
        .set('Cookie', `${config.cookieName}=parent-refresh-token`)
        .send(bodyCase.body)
        .expect(400);

      expectInvalidBodyEnvelope(response, bodyCase.requestId);
    }

    expect(database.refreshTokens[0].usedAt).toBeNull();
  });

  it('should reject primitive request bodies with the existing parser behavior without leaking token material', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database);
    app = await createAuthRefreshApplication(database, config);

    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', 'req-invalid-body-primitive')
      .set('Cookie', `${config.cookieName}=parent-refresh-token`)
      .send('42')
      .expect(400);

    expectResponseNotToLeakRefreshInput(response);
    expect(database.refreshTokens[0].usedAt).toBeNull();
  });

  it('should reject expired sessions and disabled users without issuing a child token', async () => {
    const expiredDatabase = createInMemoryRefreshDatabase();
    seedRefreshSession(expiredDatabase, {
      sessionExpiresAt: new Date('2020-01-01T00:00:00.000Z')
    });
    app = await createAuthRefreshApplication(expiredDatabase, config);

    const expiredResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${config.cookieName}=parent-refresh-token`)
      .send({})
      .expect(401);

    expect(expiredResponse.body.error.code).toBe('AUTH_REFRESH_INVALID');
    expect(readSetCookie(expiredResponse)[0]).toContain('refresh_token=');
    expect(expiredDatabase.refreshTokens).toHaveLength(1);
    await app.close();

    const disabledDatabase = createInMemoryRefreshDatabase();
    seedRefreshSession(disabledDatabase, {
      userIsActive: false
    });
    app = await createAuthRefreshApplication(disabledDatabase, config);

    const disabledResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${config.cookieName}=parent-refresh-token`)
      .send({})
      .expect(401);

    expect(disabledResponse.body.error.code).toBe('AUTH_REFRESH_INVALID');
    expect(readSetCookie(disabledResponse)[0]).toContain('refresh_token=');
    expect(disabledDatabase.refreshTokens).toHaveLength(1);
  });

  it('should set production refresh cookie attributes', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database);
    app = await createAuthRefreshApplication(database, productionCookieConfig);

    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${productionCookieConfig.cookieName}=parent-refresh-token`)
      .send({})
      .expect(200);
    const setCookie = readSetCookie(response)[0];

    expect(setCookie).toContain('__Host-refresh_token=rotated-refresh-1');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain=');
  });

  it('should allow only one winner when two refresh requests race on the same token', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database);
    app = await createAuthRefreshApplication(database, config);

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${config.cookieName}=parent-refresh-token`)
        .send({}),
      request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${config.cookieName}=parent-refresh-token`)
        .send({})
    ]);
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([200, 409]);
    expect(database.refreshTokens.filter((token) => token.parentTokenId === 'token-1')).toHaveLength(1);
    expect(database.userSessions[0].revokedAt).toBeNull();
  });

  it('should roll back parent usedAt when child token creation fails', async () => {
    const database = createInMemoryRefreshDatabase();
    seedRefreshSession(database);
    database.failNextRefreshTokenCreate = true;
    app = await createAuthRefreshApplication(database, config);
    const loggerSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    try {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${config.cookieName}=parent-refresh-token`)
        .send({})
        .expect(500);
    } finally {
      loggerSpy.mockRestore();
    }

    expect(database.refreshTokens[0].usedAt).toBeNull();
    expect(database.refreshTokens.filter((token) => token.parentTokenId === 'token-1')).toHaveLength(0);
  });
});

type StoredUser = {
  id: string;
  role: UserRole;
  isActive: boolean;
};

type StoredUserSession = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  lastSeenAt: Date;
};

type StoredRefreshToken = {
  id: string;
  sessionId: string;
  tokenHash: string;
  parentTokenId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

type StoredAuditLog = {
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, string>;
  ipHash: string;
};

type InMemoryRefreshDatabase = {
  users: StoredUser[];
  userSessions: StoredUserSession[];
  refreshTokens: StoredRefreshToken[];
  auditLogs: StoredAuditLog[];
  loginAttempts: unknown[];
  failNextRefreshTokenCreate: boolean;
  nextRefreshTokenId: number;
  prisma: {
    refreshToken: {
      findUnique: (args: { where: { tokenHash: string } }) => Promise<ReturnType<typeof mapRefreshToken> | null>;
    };
    userSession: {
      findFirst: (args: { where: { id: string; revokedAt: null; expiresAt: { gt: Date }; user: { isActive: true } } }) => Promise<ReturnType<typeof mapActiveSession> | null>;
    };
    auditLog: {
      create: (args: { data: StoredAuditLog }) => Promise<void>;
    };
    $transaction: <T>(callback: (transaction: InMemoryRefreshTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryRefreshTransaction = ReturnType<typeof createInMemoryRefreshTransaction>;

function createInMemoryRefreshDatabase(): InMemoryRefreshDatabase {
  const database = {
    users: [] as StoredUser[],
    userSessions: [] as StoredUserSession[],
    refreshTokens: [] as StoredRefreshToken[],
    auditLogs: [] as StoredAuditLog[],
    loginAttempts: [] as unknown[],
    failNextRefreshTokenCreate: false,
    nextRefreshTokenId: 2,
    prisma: {
      refreshToken: {
        findUnique: async ({ where }: { where: { tokenHash: string } }) => {
          const refreshToken =
            database.refreshTokens.find((token) => token.tokenHash === where.tokenHash) ?? null;
          return refreshToken ? mapRefreshToken(database, refreshToken) : null;
        }
      },
      userSession: {
        findFirst: async ({
          where
        }: {
          where: { id: string; revokedAt: null; expiresAt: { gt: Date }; user: { isActive: true } };
        }) => mapActiveSession(database, where.id, where.expiresAt.gt)
      },
      auditLog: {
        create: async ({ data }: { data: StoredAuditLog }) => {
          database.auditLogs.push(data);
        }
      },
      $transaction: async <T>(
        callback: (transaction: InMemoryRefreshTransaction) => Promise<T>
      ): Promise<T> => {
        const snapshot = cloneDatabaseState(database);

        try {
          return await callback(createInMemoryRefreshTransaction(database));
        } catch (error) {
          restoreDatabaseState(database, snapshot);
          throw error;
        }
      }
    }
  };

  return database;
}

function createInMemoryRefreshTransaction(database: InMemoryRefreshDatabase) {
  return {
    refreshToken: {
      updateMany: async ({
        where,
        data
      }: {
        where: { id: string; usedAt: null; revokedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      }) => {
        const refreshToken = database.refreshTokens.find((token) => token.id === where.id);

        if (
          !refreshToken ||
          refreshToken.usedAt !== null ||
          refreshToken.revokedAt !== null ||
          refreshToken.expiresAt <= where.expiresAt.gt
        ) {
          return { count: 0 };
        }

        refreshToken.usedAt = data.usedAt;
        return { count: 1 };
      },
      create: async ({ data }: { data: Omit<StoredRefreshToken, 'id' | 'usedAt' | 'revokedAt' | 'createdAt'> }) => {
        if (database.failNextRefreshTokenCreate) {
          database.failNextRefreshTokenCreate = false;
          throw new Error('child token create failed');
        }

        database.refreshTokens.push({
          id: `token-${database.nextRefreshTokenId}`,
          ...data,
          usedAt: null,
          revokedAt: null,
          createdAt: new Date()
        });
        database.nextRefreshTokenId += 1;
      }
    },
    userSession: {
      findFirst: async ({
        where
      }: {
        where: { id: string; revokedAt: null; expiresAt: { gt: Date }; user: { isActive: true } };
      }) => mapActiveSession(database, where.id, where.expiresAt.gt),
      update: async ({ where, data }: { where: { id: string }; data: { lastSeenAt: Date } }) => {
        const session = database.userSessions.find((storedSession) => storedSession.id === where.id);

        if (session) {
          session.lastSeenAt = data.lastSeenAt;
        }
      }
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        database.auditLogs.push(data);
      }
    }
  };
}

function seedRefreshSession(
  database: InMemoryRefreshDatabase,
  overrides: {
    userRole?: UserRole;
    userIsActive?: boolean;
    sessionExpiresAt?: Date;
    sessionRevokedAt?: Date | null;
    tokenExpiresAt?: Date;
    tokenUsedAt?: Date | null;
    tokenRevokedAt?: Date | null;
  } = {}
): void {
  database.users.push({
    id: 'user-1',
    role: overrides.userRole ?? UserRole.USER,
    isActive: overrides.userIsActive ?? true
  });
  database.userSessions.push({
    id: 'session-1',
    userId: 'user-1',
      expiresAt: overrides.sessionExpiresAt ?? new Date('2027-02-01T00:00:00.000Z'),
    revokedAt: overrides.sessionRevokedAt ?? null,
    revokeReason: null,
    lastSeenAt: new Date('2026-01-01T00:00:00.000Z')
  });
  database.refreshTokens.push({
    id: 'token-1',
    sessionId: 'session-1',
    tokenHash: hashToken('parent-refresh-token'),
    parentTokenId: null,
    expiresAt: overrides.tokenExpiresAt ?? new Date('2027-02-01T00:00:00.000Z'),
    usedAt: overrides.tokenUsedAt ?? null,
    revokedAt: overrides.tokenRevokedAt ?? null,
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  });
}

function mapRefreshToken(database: InMemoryRefreshDatabase, refreshToken: StoredRefreshToken) {
  const session = database.userSessions.find((storedSession) => storedSession.id === refreshToken.sessionId);
  const user = session ? database.users.find((storedUser) => storedUser.id === session.userId) : undefined;

  if (!session || !user) {
    return null;
  }

  return {
    id: refreshToken.id,
    sessionId: refreshToken.sessionId,
    expiresAt: refreshToken.expiresAt,
    usedAt: refreshToken.usedAt,
    revokedAt: refreshToken.revokedAt,
    session: {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      user: {
        id: user.id,
        role: user.role,
        isActive: user.isActive
      }
    }
  };
}

function mapActiveSession(database: InMemoryRefreshDatabase, sessionId: string, now: Date) {
  const session = database.userSessions.find((storedSession) => storedSession.id === sessionId);
  const user = session ? database.users.find((storedUser) => storedUser.id === session.userId) : undefined;

  if (!session || !user || session.revokedAt || session.expiresAt <= now || !user.isActive) {
    return null;
  }

  return {
    id: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt,
    user: {
      role: user.role
    }
  };
}

function createRefreshTokenFamilyRevoker(database: InMemoryRefreshDatabase) {
  return async (sessionId: string, revokedAt: Date) => {
    const session = database.userSessions.find((storedSession) => storedSession.id === sessionId);

    if (session) {
      session.revokedAt = revokedAt;
      session.revokeReason = 'refresh_reused';
    }

    for (const refreshToken of database.refreshTokens) {
      if (refreshToken.sessionId === sessionId && refreshToken.revokedAt === null) {
        refreshToken.revokedAt = revokedAt;
      }
    }
  };
}

async function createAuthRefreshApplication(
  database: InMemoryRefreshDatabase,
  authConfig: AuthConfig
): Promise<INestApplication> {
  let nextTokenCounter = 1;
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      RefreshService,
      RefreshRateLimitService,
      SessionService,
      {
        provide: AUTH_CONFIG,
        useValue: authConfig
      },
      {
        provide: PrismaService,
        useValue: database.prisma
      },
      {
        provide: RegisterService,
        useValue: {
          register: vi.fn()
        }
      },
      {
        provide: LoginService,
        useValue: {
          login: vi.fn()
        }
      },
      {
        provide: EmailVerificationService,
        useValue: {
          verifyEmail: vi.fn()
        }
      },
      {
        provide: LogoutService,
        useValue: {
          logout: vi.fn()
        }
      },
      {
        provide: RefreshTokenService,
        useValue: {
          revokeTokenFamily: vi.fn(createRefreshTokenFamilyRevoker(database))
        }
      },
      {
        provide: AccessTokenService,
        useValue: {
          signAccessToken: vi.fn(
            ({ role, sessionId }: { role: string; sessionId: string }) => `access-token:${role}:${sessionId}`
          )
        }
      },
      {
        provide: TokenHashService,
        useValue: {
          generateOpaqueToken: vi.fn(() => {
            const token = `rotated-refresh-${nextTokenCounter}`;
            nextTokenCounter += 1;
            return token;
          }),
          hashToken
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

function cloneDatabaseState(database: InMemoryRefreshDatabase) {
  return {
    users: database.users.map((user) => ({ ...user })),
    userSessions: database.userSessions.map((session) => ({ ...session })),
    refreshTokens: database.refreshTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log })),
    loginAttempts: [...database.loginAttempts],
    failNextRefreshTokenCreate: database.failNextRefreshTokenCreate,
    nextRefreshTokenId: database.nextRefreshTokenId
  };
}

function restoreDatabaseState(
  database: InMemoryRefreshDatabase,
  snapshot: ReturnType<typeof cloneDatabaseState>
): void {
  database.users = snapshot.users;
  database.userSessions = snapshot.userSessions;
  database.refreshTokens = snapshot.refreshTokens;
  database.auditLogs = snapshot.auditLogs;
  database.loginAttempts = snapshot.loginAttempts;
  database.failNextRefreshTokenCreate = snapshot.failNextRefreshTokenCreate;
  database.nextRefreshTokenId = snapshot.nextRefreshTokenId;
}

function hashToken(value: string): string {
  return `hmac-sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readSetCookie(response: { headers: Record<string, string | string[] | undefined> }): string[] {
  const header = response.headers['set-cookie'];

  if (Array.isArray(header)) {
    return header;
  }

  return header ? [header] : [];
}

function expectInvalidBodyEnvelope(response: { body: unknown }, requestId: string): void {
  expect(response.body).toEqual({
    error: {
      code: AUTH_REFRESH_INVALID_BODY_CODE,
      message: AUTH_REFRESH_INVALID_BODY_MESSAGE,
      requestId
    }
  });
  expectResponseNotToLeakRefreshInput(response);
}

function expectResponseNotToLeakRefreshInput(response: { body: unknown }): void {
  const serializedBody = JSON.stringify(response.body);

  expect(serializedBody).not.toContain('parent-refresh-token');
  expect(serializedBody).not.toContain('refresh_token=parent-refresh-token');
  expect(serializedBody).not.toContain('rotated-refresh');
  expect(serializedBody).not.toContain('token-1');
  expect(serializedBody).not.toContain('session-1');
  expect(serializedBody).not.toContain('Prisma');
  expect(serializedBody).not.toContain('database');
}

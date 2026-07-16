import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@football-manager/database';
import { createHash } from 'crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import {
  AUTH_LOGOUT_INVALID_BODY_CODE,
  AUTH_LOGOUT_INVALID_BODY_MESSAGE
} from '../errors/auth-logout-invalid-body.exception';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshService } from '../services/refresh.service';
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
const CURRENT_COOKIE_VALUE = ['current', 'cookie', 'fixture'].join('-');
const CURRENT_CHILD_COOKIE_VALUE = ['current', 'cookie', 'child', 'fixture'].join('-');
const OTHER_COOKIE_VALUE = ['other', 'cookie', 'fixture'].join('-');
const FORGED_COOKIE_VALUE = ['forged', 'cookie', 'fixture'].join('-');
const BODY_COOKIE_VALUE = ['body', 'cookie', 'fixture'].join('-');
const QUERY_COOKIE_VALUE = ['query', 'cookie', 'fixture'].join('-');
const HEADER_COOKIE_VALUE = ['header', 'cookie', 'fixture'].join('-');

describe('AuthController logout', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('should logout the current session, revoke its refresh token family, clear the cookie, and return no body', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    app = await createAuthLogoutApplication(database, config);

    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `${config.cookieName}=${CURRENT_COOKIE_VALUE}`)
      .send({})
      .expect(204);
    const setCookie = readSetCookie(response)[0];

    expect(response.text).toBe('');
    expect(setCookie).toContain('refresh_token=');
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(database.userSessions[0]).toMatchObject({
      revokedAt: expect.any(Date),
      revokeReason: 'user_logout'
    });
    expect(
      database.refreshTokens
        .filter((token) => token.sessionId === 'session-1')
        .every((token) => token.revokedAt instanceof Date)
    ).toBe(true);
    expect(database.userSessions[1].revokedAt).toBeNull();
    expect(database.refreshTokens.find((token) => token.sessionId === 'session-2')?.revokedAt).toBeNull();
    expect(database.cacheInvalidations).toEqual(['session-1']);
    expect(database.loginAttempts).toHaveLength(0);
    expect(database.auditLogs).toContainEqual(
      expect.objectContaining({
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.LOGOUT,
        entityType: 'UserSession',
        entityId: 'session-1',
        metadata: {
          context: 'LOGOUT',
          reason: 'user_logout',
          sessionId: 'session-1'
        }
      })
    );
    expect(JSON.stringify(response.body)).not.toContain(CURRENT_COOKIE_VALUE);
    expect(JSON.stringify(database.auditLogs)).not.toContain(CURRENT_COOKIE_VALUE);
  });

  it('should remain idempotent when the same cookie is submitted again', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    app = await createAuthLogoutApplication(database, config);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `${config.cookieName}=${CURRENT_COOKIE_VALUE}`)
      .send({})
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `${config.cookieName}=${CURRENT_COOKIE_VALUE}`)
      .send({})
      .expect(204);

    expect(database.cacheInvalidations).toEqual(['session-1']);
    expect(database.auditLogs.filter((log) => log.action === AUTH_AUDIT_EVENTS.LOGOUT)).toHaveLength(1);
  });

  it('should clear the cookie and return 204 without database lookup when the cookie is missing', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    app = await createAuthLogoutApplication(database, config);

    const response = await request(app.getHttpServer()).post('/auth/logout').send({}).expect(204);

    expect(response.text).toBe('');
    expect(readSetCookie(response)[0]).toContain('refresh_token=');
    expect(database.refreshTokenFinds).toBe(0);
    expect(database.userSessions.every((session) => session.revokedAt === null)).toBe(true);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should clear the cookie and return 204 for a forged or unknown cookie', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    app = await createAuthLogoutApplication(database, config);

    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `${config.cookieName}=${FORGED_COOKIE_VALUE}`)
      .send({})
      .expect(204);

    expect(response.text).toBe('');
    expect(readSetCookie(response)[0]).toContain('refresh_token=');
    expect(database.userSessions.every((session) => session.revokedAt === null)).toBe(true);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should not accept refresh tokens from query or headers', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    app = await createAuthLogoutApplication(database, config);

    await request(app.getHttpServer())
      .post(`/auth/logout?refreshToken=${QUERY_COOKIE_VALUE}`)
      .set('X-Refresh-Token', HEADER_COOKIE_VALUE)
      .send({})
      .expect(204);

    expect(database.refreshTokenFinds).toBe(0);
    expect(database.userSessions.every((session) => session.revokedAt === null)).toBe(true);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should reject a non-empty body with the standard logout error envelope', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    app = await createAuthLogoutApplication(database, config);

    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('X-Request-Id', 'req-logout-invalid-body')
      .set('Cookie', `${config.cookieName}=${CURRENT_COOKIE_VALUE}`)
      .send({
        refreshToken: BODY_COOKIE_VALUE
      })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: AUTH_LOGOUT_INVALID_BODY_CODE,
        message: AUTH_LOGOUT_INVALID_BODY_MESSAGE,
        requestId: 'req-logout-invalid-body'
      }
    });
    expect(JSON.stringify(response.body)).not.toContain(BODY_COOKIE_VALUE);
    expect(database.userSessions[0].revokedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should reject array bodies with the logout error envelope', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    app = await createAuthLogoutApplication(database, config);

    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('X-Request-Id', 'req-logout-array-body')
      .set('Cookie', `${config.cookieName}=${CURRENT_COOKIE_VALUE}`)
      .send([BODY_COOKIE_VALUE])
      .expect(400);

    expect(response.body.error).toEqual({
      code: AUTH_LOGOUT_INVALID_BODY_CODE,
      message: AUTH_LOGOUT_INVALID_BODY_MESSAGE,
      requestId: 'req-logout-array-body'
    });
    expect(JSON.stringify(response.body)).not.toContain(BODY_COOKIE_VALUE);
    expect(database.userSessions[0].revokedAt).toBeNull();
  });

  it('should set production clear-cookie attributes without a Domain attribute', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    app = await createAuthLogoutApplication(database, productionCookieConfig);

    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `${productionCookieConfig.cookieName}=${CURRENT_COOKIE_VALUE}`)
      .send({})
      .expect(204);
    const setCookie = readSetCookie(response)[0];

    expect(setCookie).toContain('__Host-refresh_token=');
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain=');
  });

  it('should not leave a partially revoked session if refresh token revoke fails', async () => {
    const database = createInMemoryLogoutDatabase();
    seedLogoutSessions(database);
    database.failNextRefreshTokenRevoke = true;
    app = await createAuthLogoutApplication(database, config);
    const loggerSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    try {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `${config.cookieName}=${CURRENT_COOKIE_VALUE}`)
        .send({})
        .expect(500);
    } finally {
      loggerSpy.mockRestore();
    }

    expect(database.userSessions[0].revokedAt).toBeNull();
    expect(database.userSessions[0].revokeReason).toBeNull();
    expect(database.refreshTokens.every((token) => token.revokedAt === null)).toBe(true);
    expect(database.cacheInvalidations).toHaveLength(0);
    expect(database.auditLogs).toHaveLength(0);
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

type InMemoryLogoutDatabase = {
  users: StoredUser[];
  userSessions: StoredUserSession[];
  refreshTokens: StoredRefreshToken[];
  auditLogs: StoredAuditLog[];
  loginAttempts: unknown[];
  cacheInvalidations: string[];
  failNextRefreshTokenRevoke: boolean;
  refreshTokenFinds: number;
  prisma: {
    refreshToken: {
      findUnique: (args: { where: { tokenHash: string } }) => Promise<ReturnType<typeof mapLogoutToken> | null>;
    };
    auditLog: {
      create: (args: { data: StoredAuditLog }) => Promise<void>;
    };
  };
};

function createInMemoryLogoutDatabase(): InMemoryLogoutDatabase {
  const database = {
    users: [] as StoredUser[],
    userSessions: [] as StoredUserSession[],
    refreshTokens: [] as StoredRefreshToken[],
    auditLogs: [] as StoredAuditLog[],
    loginAttempts: [] as unknown[],
    cacheInvalidations: [] as string[],
    failNextRefreshTokenRevoke: false,
    refreshTokenFinds: 0,
    prisma: {
      refreshToken: {
        findUnique: async ({ where }: { where: { tokenHash: string } }) => {
          database.refreshTokenFinds += 1;
          const refreshToken =
            database.refreshTokens.find((token) => token.tokenHash === where.tokenHash) ?? null;
          return refreshToken ? mapLogoutToken(database, refreshToken) : null;
        }
      },
      auditLog: {
        create: async ({ data }: { data: StoredAuditLog }) => {
          database.auditLogs.push(data);
        }
      }
    }
  };

  return database;
}

function seedLogoutSessions(database: InMemoryLogoutDatabase): void {
  database.users.push(
    {
      id: 'user-1',
      role: UserRole.USER,
      isActive: true
    },
    {
      id: 'user-2',
      role: UserRole.USER,
      isActive: true
    }
  );
  database.userSessions.push(
    {
      id: 'session-1',
      userId: 'user-1',
      expiresAt: new Date('2027-02-01T00:00:00.000Z'),
      revokedAt: null,
      revokeReason: null,
      lastSeenAt: new Date('2026-01-01T00:00:00.000Z')
    },
    {
      id: 'session-2',
      userId: 'user-2',
      expiresAt: new Date('2027-02-01T00:00:00.000Z'),
      revokedAt: null,
      revokeReason: null,
      lastSeenAt: new Date('2026-01-01T00:00:00.000Z')
    }
  );
  database.refreshTokens.push(
    createRefreshToken({
      id: 'token-1',
      sessionId: 'session-1',
      tokenHash: hashToken(CURRENT_COOKIE_VALUE)
    }),
    createRefreshToken({
      id: 'token-2',
      sessionId: 'session-1',
      parentTokenId: 'token-1',
      tokenHash: hashToken(CURRENT_CHILD_COOKIE_VALUE)
    }),
    createRefreshToken({
      id: 'token-3',
      sessionId: 'session-2',
      tokenHash: hashToken(OTHER_COOKIE_VALUE)
    })
  );
}

function createRefreshToken(overrides: Partial<StoredRefreshToken>): StoredRefreshToken {
  return {
    id: overrides.id ?? 'token-id',
    sessionId: overrides.sessionId ?? 'session-1',
    tokenHash: overrides.tokenHash ?? hashToken('cookie-fixture'),
    parentTokenId: overrides.parentTokenId ?? null,
    expiresAt: overrides.expiresAt ?? new Date('2027-02-01T00:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z')
  };
}

function mapLogoutToken(database: InMemoryLogoutDatabase, refreshToken: StoredRefreshToken) {
  const session = database.userSessions.find((storedSession) => storedSession.id === refreshToken.sessionId);

  return {
    sessionId: refreshToken.sessionId,
    session: session
      ? {
          id: session.id,
          userId: session.userId,
          revokedAt: session.revokedAt
        }
      : null
  };
}

function createSessionRevoker(database: InMemoryLogoutDatabase) {
  return async (sessionId: string, revokeReason: string, revokedAt: Date) => {
    const snapshot = cloneDatabaseState(database);
    const session = database.userSessions.find((storedSession) => storedSession.id === sessionId);

    if (session && session.revokedAt === null) {
      session.revokedAt = revokedAt;
      session.revokeReason = revokeReason;
    }

    if (database.failNextRefreshTokenRevoke) {
      database.failNextRefreshTokenRevoke = false;
      restoreDatabaseState(database, snapshot);
      throw new Error('refresh token revoke failed');
    }

    for (const refreshToken of database.refreshTokens) {
      if (refreshToken.sessionId === sessionId && refreshToken.revokedAt === null) {
        refreshToken.revokedAt = revokedAt;
      }
    }

    database.cacheInvalidations.push(sessionId);
  };
}

async function createAuthLogoutApplication(
  database: InMemoryLogoutDatabase,
  authConfig: AuthConfig
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      LogoutService,
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
        provide: RefreshService,
        useValue: {
          refresh: vi.fn()
        }
      },
      {
        provide: SessionService,
        useValue: {
          revokeSession: vi.fn(createSessionRevoker(database))
        }
      },
      {
        provide: TokenHashService,
        useValue: {
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

function cloneDatabaseState(database: InMemoryLogoutDatabase) {
  return {
    userSessions: database.userSessions.map((session) => ({ ...session })),
    refreshTokens: database.refreshTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log })),
    loginAttempts: [...database.loginAttempts],
    cacheInvalidations: [...database.cacheInvalidations],
    failNextRefreshTokenRevoke: database.failNextRefreshTokenRevoke
  };
}

function restoreDatabaseState(
  database: InMemoryLogoutDatabase,
  snapshot: ReturnType<typeof cloneDatabaseState>
): void {
  database.userSessions = snapshot.userSessions;
  database.refreshTokens = snapshot.refreshTokens;
  database.auditLogs = snapshot.auditLogs;
  database.loginAttempts = snapshot.loginAttempts;
  database.cacheInvalidations = snapshot.cacheInvalidations;
  database.failNextRefreshTokenRevoke = snapshot.failNextRefreshTokenRevoke;
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

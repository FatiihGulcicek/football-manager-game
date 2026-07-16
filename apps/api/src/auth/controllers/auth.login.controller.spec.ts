import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoginContext, UserRole } from '@football-manager/database';
import { createHash } from 'crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { applyTrustProxy } from '../../http/trust-proxy';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { AccessTokenService } from '../services/access-token.service';
import { LoginRateLimitService } from '../services/login-rate-limit.service';
import { LoginService } from '../services/login.service';
import { PasswordService } from '../services/password.service';
import { RefreshTokenService } from '../services/refresh-token.service';
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

describe('AuthController login', () => {
  let app: INestApplication;
  let database: InMemoryLoginDatabase;

  beforeEach(async () => {
    database = createInMemoryLoginDatabase();
    seedLoginUsers(database);
    app = await createAuthLoginApplication(database, config);
  });

  afterEach(async () => {
    await app.close();
  });

  it('should login successfully, issue an access token, and set an HttpOnly refresh cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('User-Agent', windowsChromeUserAgent())
      .send({
        email: '  USER@Example.INVALID  ',
        password: 'CorrectPass123'
      })
      .expect(200);

    expect(response.body).toEqual({
      accessToken: 'access-token-for-test',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: 'user-1',
        email: 'user@example.invalid',
        role: UserRole.USER,
        managerProfile: {
          displayName: 'Verified Manager'
        }
      }
    });
    expect(response.body).not.toHaveProperty('refreshToken');
    expect(response.body).not.toHaveProperty('refreshCookie');
    const setCookie = readSetCookie(response);
    expect(setCookie[0]).toContain('refresh_token=opaque-refresh-fixture');
    expect(setCookie[0]).toContain('HttpOnly');
    expect(setCookie[0]).toContain('SameSite=Lax');
    expect(setCookie[0]).not.toContain('Secure');
    expect(database.userSessions).toHaveLength(1);
    expect(database.userSessions[0]).toMatchObject({
      userId: 'user-1',
      deviceName: 'Windows Chrome',
      deviceType: 'desktop',
      browser: 'Chrome',
      operatingSystem: 'Windows',
      revokedAt: null
    });
    expect(database.refreshTokens).toHaveLength(1);
    expect(database.refreshTokens[0]).toMatchObject({
      sessionId: database.userSessions[0].id,
      tokenHash: `hmac-sha256:${sha256('opaque-refresh-fixture')}`,
      usedAt: null,
      revokedAt: null
    });
    expect(JSON.stringify(database.refreshTokens)).not.toContain('opaque-refresh-fixture');
    expect(JSON.stringify(database)).not.toContain('CorrectPass123');
  });

  it('should return the same generic 401 body for invalid credential states', async () => {
    const payloads = [
      {
        email: 'user@example.invalid',
        password: 'WrongPass123'
      },
      {
        email: 'missing@example.invalid',
        password: 'CorrectPass123'
      },
      {
        email: 'disabled@example.invalid',
        password: 'CorrectPass123'
      },
      {
        email: 'unverified@example.invalid',
        password: 'CorrectPass123'
      }
    ];
    const bodies = [];

    for (const payload of payloads) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-request-id', 'req-same')
        .send(payload)
        .expect(401);
      bodies.push(response.body);
      expect(readSetCookie(response)).toHaveLength(0);
    }

    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'E-posta veya şifre hatalı.',
        requestId: 'req-same'
      }
    });
    expect(database.userSessions).toHaveLength(0);
    expect(database.refreshTokens).toHaveLength(0);
    expect(database.loginAttempts.filter((attempt) => !attempt.success)).toHaveLength(4);
    expect(database.auditLogs.filter((log) => log.action === AUTH_AUDIT_EVENTS.LOGIN_FAILED)).toHaveLength(4);
  });

  it('should store ADMIN context without accepting client supplied role', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user@example.invalid',
        password: 'CorrectPass123',
        context: LoginContext.ADMIN
      })
      .expect(200);

    expect(response.body.user.role).toBe(UserRole.USER);
    expect(database.loginAttempts[0]).toMatchObject({
      success: true,
      context: LoginContext.ADMIN
    });

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user@example.invalid',
        password: 'CorrectPass123',
        role: 'ADMIN'
      })
      .expect(400);
  });

  it('should set the production __Host refresh cookie attributes without a Domain attribute', async () => {
    await app.close();
    database = createInMemoryLoginDatabase();
    seedLoginUsers(database);
    app = await createAuthLoginApplication(database, productionCookieConfig);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user@example.invalid',
        password: 'CorrectPass123'
      })
      .expect(200);
    const setCookie = readSetCookie(response);

    expect(setCookie[0]).toContain('__Host-refresh_token=opaque-refresh-fixture');
    expect(setCookie[0]).toContain('HttpOnly');
    expect(setCookie[0]).toContain('Secure');
    expect(setCookie[0]).toContain('SameSite=Lax');
    expect(setCookie[0]).toContain('Path=/');
    expect(setCookie[0]).not.toContain('Domain=');
  });

  it('should ignore spoofed X-Forwarded-For when trust proxy is disabled', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.10')
      .send({
        email: 'user@example.invalid',
        password: 'CorrectPass123'
      })
      .expect(200);

    const spoofedIpHash = `hmac-sha256:${sha256('ip:198.51.100.10')}`;
    expect(database.userSessions[0].ipHash).not.toBe(spoofedIpHash);
    expect(database.loginAttempts[0].ipHash).toBe(database.userSessions[0].ipHash);
  });

  it('should use Express request.ip after a trusted proxy hop resolves the client IP', async () => {
    await app.close();
    database = createInMemoryLoginDatabase();
    seedLoginUsers(database);
    app = await createAuthLoginApplication(database, {
      ...config,
      trustProxyHops: 1
    });

    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.20')
      .send({
        email: 'user@example.invalid',
        password: 'CorrectPass123'
      })
      .expect(200);

    const trustedIpHash = `hmac-sha256:${sha256('ip:198.51.100.20')}`;
    expect(database.userSessions[0].ipHash).toBe(trustedIpHash);
    expect(database.loginAttempts[0].ipHash).toBe(trustedIpHash);
  });

  it('should not write raw email, IP, user-agent, password, or raw tokens to audit metadata', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('User-Agent', windowsChromeUserAgent())
      .send({
        email: 'user@example.invalid',
        password: 'CorrectPass123'
      })
      .expect(200);

    const auditPayload = JSON.stringify(database.auditLogs);
    expect(auditPayload).not.toContain('user@example.invalid');
    expect(auditPayload).not.toContain('127.0.0.1');
    expect(auditPayload).not.toContain(windowsChromeUserAgent());
    expect(auditPayload).not.toContain('CorrectPass123');
    expect(auditPayload).not.toContain('opaque-refresh-fixture');
    expect(auditPayload).not.toContain('access-token-for-test');
  });
});

type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  managerProfile: {
    displayName: string;
  } | null;
};

type StoredUserSession = {
  id: string;
  userId: string;
  tokenFamilyId: string;
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  operatingSystem?: string;
  ipHash?: string;
  userAgentHash?: string;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

type StoredRefreshToken = {
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

type StoredLoginAttempt = {
  userId: string | null;
  emailHash: string;
  success: boolean;
  failureReason: string | null;
  ipHash: string;
  userAgentHash?: string;
  context: LoginContext;
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

type InMemoryLoginDatabase = {
  users: StoredUser[];
  userSessions: StoredUserSession[];
  refreshTokens: StoredRefreshToken[];
  loginAttempts: StoredLoginAttempt[];
  auditLogs: StoredAuditLog[];
  prisma: {
    user: {
      findUnique: (args: { where: { email: string } }) => Promise<StoredUser | null>;
    };
    $transaction: <T>(callback: (transaction: InMemoryLoginTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryLoginTransaction = ReturnType<typeof createInMemoryLoginTransaction>;

function createInMemoryLoginDatabase(): InMemoryLoginDatabase {
  const database = {
    users: [] as StoredUser[],
    userSessions: [] as StoredUserSession[],
    refreshTokens: [] as StoredRefreshToken[],
    loginAttempts: [] as StoredLoginAttempt[],
    auditLogs: [] as StoredAuditLog[],
    prisma: {
      user: {
        findUnique: async ({ where }: { where: { email: string } }) =>
          database.users.find((user) => user.email === where.email) ?? null
      },
      $transaction: async <T>(callback: (transaction: InMemoryLoginTransaction) => Promise<T>) =>
        callback(createInMemoryLoginTransaction(database))
    }
  };

  return database;
}

function createInMemoryLoginTransaction(database: Omit<InMemoryLoginDatabase, 'prisma'>) {
  return {
    user: {
      update: async ({ where, data }: { where: { id: string }; data: { lastLoginAt: Date } }) => {
        const user = database.users.find((storedUser) => storedUser.id === where.id);

        if (user) {
          user.lastLoginAt = data.lastLoginAt;
        }
      }
    },
    userSession: {
      create: async ({
        data
      }: {
        data: Omit<StoredUserSession, 'id' | 'lastSeenAt' | 'revokedAt'> & { lastSeenAt: Date };
      }) => {
        const session = {
          id: `session-${database.userSessions.length + 1}`,
          ...data,
          revokedAt: null
        };
        database.userSessions.push(session);
        return session;
      }
    },
    refreshToken: {
      create: async ({ data }: { data: Omit<StoredRefreshToken, 'usedAt' | 'revokedAt'> }) => {
        database.refreshTokens.push({
          ...data,
          usedAt: null,
          revokedAt: null
        });
      }
    },
    loginAttempt: {
      create: async ({ data }: { data: StoredLoginAttempt }) => {
        database.loginAttempts.push(data);
      }
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        database.auditLogs.push(data);
      }
    }
  };
}

function seedLoginUsers(database: InMemoryLoginDatabase): void {
  database.users.push(
    createUser({ id: 'user-1', email: 'user@example.invalid' }),
    createUser({ id: 'user-2', email: 'disabled@example.invalid', isActive: false }),
    createUser({ id: 'user-3', email: 'unverified@example.invalid', emailVerifiedAt: null })
  );
}

function createUser(overrides: Partial<StoredUser>): StoredUser {
  return {
    id: overrides.id ?? 'user-id',
    email: overrides.email ?? 'user@example.invalid',
    passwordHash: 'hash:correct-password',
    role: UserRole.USER,
    isActive: overrides.isActive ?? true,
    emailVerifiedAt:
      overrides.emailVerifiedAt === undefined
        ? new Date('2026-01-01T00:00:00.000Z')
        : overrides.emailVerifiedAt,
    lastLoginAt: null,
    managerProfile: {
      displayName: 'Verified Manager'
    },
    ...overrides
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function windowsChromeUserAgent(): string {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
}

async function createAuthLoginApplication(
  database: InMemoryLoginDatabase,
  authConfig: AuthConfig
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      LoginService,
      LoginRateLimitService,
      SessionService,
      RefreshTokenService,
      {
        provide: RefreshService,
        useValue: {
          refresh: vi.fn()
        }
      },
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
        provide: PasswordService,
        useValue: {
          verifyPassword: vi.fn(async (hash: string, password: string) => {
            return hash === 'hash:correct-password' && password === 'CorrectPass123';
          }),
          verifyAgainstDummy: vi.fn(async () => false)
        }
      },
      {
        provide: AccessTokenService,
        useValue: {
          signAccessToken: vi.fn(() => 'access-token-for-test')
        }
      },
      {
        provide: TokenHashService,
        useValue: {
          generateOpaqueToken: vi.fn(() => 'opaque-refresh-fixture'),
          hashToken: vi.fn((value: string) => `hmac-sha256:${sha256(value)}`)
        }
      }
    ]
  }).compile();
  const nestApp = moduleRef.createNestApplication();
  applyTrustProxy(nestApp, authConfig);
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

function readSetCookie(response: { headers: Record<string, string | string[] | undefined> }): string[] {
  const header = response.headers['set-cookie'];

  if (Array.isArray(header)) {
    return header;
  }

  return header ? [header] : [];
}

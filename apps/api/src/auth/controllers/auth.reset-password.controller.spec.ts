import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { UserRole } from '@football-manager/database';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { applySafeBodyParser } from '../../http/safe-body-parser';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { RESET_PASSWORD_SUCCESS_RESPONSE } from '../dto/reset-password.dto';
import {
  AUTH_RESET_PASSWORD_INVALID_CODE,
  AUTH_RESET_PASSWORD_INVALID_MESSAGE
} from '../errors/auth-reset-password-invalid.exception';
import { EmailVerificationResendService } from '../services/email-verification-resend.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { ForgotPasswordService } from '../services/forgot-password.service';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { PasswordResetRateLimitService } from '../services/password-reset-rate-limit.service';
import { PasswordService, PasswordValidationError } from '../services/password.service';
import { RefreshService } from '../services/refresh.service';
import { RegisterService } from '../services/register.service';
import { ResetPasswordService } from '../services/reset-password.service';
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

const NOW = new Date('2026-07-17T10:00:00.000Z');
const RAW_TOKEN = 'controller_reset_token_00000000000000001';
const TOKEN_HASH = `hash:${RAW_TOKEN}`;
const NEW_PASSWORD = 'NewPassword123';

describe('AuthController reset-password', () => {
  let app: INestApplication;
  let database: InMemoryResetPasswordControllerDatabase;
  let passwordService: ReturnType<typeof createPasswordServiceMock>;

  beforeEach(async () => {
    database = createInMemoryResetPasswordControllerDatabase();
    seedResetPasswordControllerDatabase(database);
    passwordService = createPasswordServiceMock();
    app = await createAuthResetPasswordApplication(database, passwordService, config);
  });

  afterEach(async () => {
    await app.close();
  });

  it('should reset password with body token only and return the exact success response', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Request-Id', 'req-controller-success')
      .send({
        token: RAW_TOKEN,
        newPassword: NEW_PASSWORD
      })
      .expect(200);

    expect(response.body).toEqual(RESET_PASSWORD_SUCCESS_RESPONSE);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(database.users.find((user) => user.id === 'user-1')?.passwordHash).toBe('hash:password:NewPassword123');
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.usedAt).toBeInstanceOf(Date);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.revokedAt).toBeNull();
    expect(database.passwordResetTokens.find((token) => token.id === 'token-peer-active')?.revokedAt).toBeInstanceOf(
      Date
    );
    expect(database.userSessions.find((session) => session.id === 'session-1')?.revokedAt).toBeInstanceOf(Date);
    expect(database.refreshTokens.find((token) => token.id === 'refresh-1')?.revokedAt).toBeInstanceOf(Date);
    expect(database.auditLogs).toHaveLength(1);
    expect(database.auditLogs[0]).toMatchObject({
      action: AUTH_AUDIT_EVENTS.PASSWORD_RESET_COMPLETED,
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      metadata: {
        context: 'WEB',
        resetMethod: 'EMAIL_TOKEN',
        sessionsRevoked: true
      }
    });
    expectResponseNotToLeakResetData(response);
  });

  it('should return the same generic invalid-token envelope for unknown, expired, used, revoked, disabled, unverified, and missing-user tokens', async () => {
    const cases: Array<[string, () => void]> = [
      ['unknown', () => database.passwordResetTokens.splice(0, database.passwordResetTokens.length)],
      ['expired', () => setCurrentToken({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })],
      ['used', () => setCurrentToken({ usedAt: new Date('2026-07-17T09:00:00.000Z') })],
      ['revoked', () => setCurrentToken({ revokedAt: new Date('2026-07-17T09:00:00.000Z') })],
      ['disabled', () => setUser({ isActive: false })],
      ['unverified', () => setUser({ emailVerifiedAt: null })],
      ['missing user', () => database.users.splice(0, database.users.length)]
    ];

    for (const [label, mutate] of cases) {
      await app.close();
      database = createInMemoryResetPasswordControllerDatabase();
      seedResetPasswordControllerDatabase(database);
      passwordService = createPasswordServiceMock();
      mutate();
      app = await createAuthResetPasswordApplication(database, passwordService, config);

      const response = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Request-Id', `req-${label.replace(' ', '-')}`)
        .send({
          token: RAW_TOKEN,
          newPassword: NEW_PASSWORD
        })
        .expect(400);

      expect(response.body).toEqual({
        error: {
          code: AUTH_RESET_PASSWORD_INVALID_CODE,
          message: AUTH_RESET_PASSWORD_INVALID_MESSAGE,
          requestId: `req-${label.replace(' ', '-')}`
        }
      });
      const user = database.users.find((storedUser) => storedUser.id === 'user-1');

      if (user) {
        expect(user.passwordHash).toBe('old-password-hash');
      }
      expect(database.auditLogs).toHaveLength(0);
      expectResponseNotToLeakResetData(response);
    }
  });

  it('should reject malformed bodies and unsupported fields before side effects', async () => {
    const cases: unknown[] = [
      {},
      { token: RAW_TOKEN },
      { newPassword: NEW_PASSWORD },
      { token: '', newPassword: NEW_PASSWORD },
      { token: '   ', newPassword: NEW_PASSWORD },
      { token: 'short', newPassword: NEW_PASSWORD },
      { token: `${RAW_TOKEN}\n`, newPassword: NEW_PASSWORD },
      { token: `${RAW_TOKEN}\t`, newPassword: NEW_PASSWORD },
      { token: null, newPassword: NEW_PASSWORD },
      { token: [RAW_TOKEN], newPassword: NEW_PASSWORD },
      { token: { value: RAW_TOKEN }, newPassword: NEW_PASSWORD },
      { token: RAW_TOKEN, newPassword: null },
      { token: RAW_TOKEN, newPassword: ['NewPassword123'] },
      { token: RAW_TOKEN, newPassword: NEW_PASSWORD, role: UserRole.ADMIN },
      { token: RAW_TOKEN, newPassword: NEW_PASSWORD, nested: { token: RAW_TOKEN } }
    ];

    for (const body of cases) {
      const response = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send(body as string | object | undefined)
        .expect(400);

      expectResponseNotToLeakResetData(response);
    }

    expect(database.users.find((user) => user.id === 'user-1')?.passwordHash).toBe('old-password-hash');
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.usedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should reject array, primitive, and malformed JSON bodies without reflecting raw values', async () => {
    const arrayResponse = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send([RAW_TOKEN])
      .expect(400);
    const primitiveResponse = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('Content-Type', 'application/json')
      .send('"controller-secret-body"')
      .expect(400);
    const numericResponse = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('Content-Type', 'application/json')
      .send('42')
      .expect(400);
    const malformedJsonResponse = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('Content-Type', 'application/json')
      .send(`{"token":"${RAW_TOKEN}"`)
      .expect(400);

    expect(malformedJsonResponse.body).toMatchObject({
      error: {
        code: 'INVALID_JSON_BODY',
        requestId: expect.any(String)
      }
    });
    expectResponseNotToLeakResetData(arrayResponse);
    expectResponseNotToLeakResetData(primitiveResponse);
    expectResponseNotToLeakResetData(numericResponse);
    expectResponseNotToLeakResetData(malformedJsonResponse);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should not accept token from query, headers, cookies, or Authorization', async () => {
    const response = await request(app.getHttpServer())
      .post(`/auth/reset-password?token=${RAW_TOKEN}`)
      .set('X-Reset-Token', RAW_TOKEN)
      .set('Authorization', `Bearer ${RAW_TOKEN}`)
      .set('Cookie', `reset_token=${RAW_TOKEN}; refresh_token=${RAW_TOKEN}`)
      .send({
        newPassword: NEW_PASSWORD
      })
      .expect(400);

    expectResponseNotToLeakResetData(response);
    expect(database.users.find((user) => user.id === 'user-1')?.passwordHash).toBe('old-password-hash');
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should leave the token unconsumed and sessions active when password policy fails', async () => {
    passwordService.hashPassword.mockRejectedValueOnce(new PasswordValidationError('weak password'));

    const response = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: RAW_TOKEN,
        newPassword: 'weak'
      })
      .expect(400);

    expectResponseNotToLeakResetData(response);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.usedAt).toBeNull();
    expect(database.userSessions.find((session) => session.id === 'session-1')?.revokedAt).toBeNull();
    expect(database.refreshTokens.find((token) => token.id === 'refresh-1')?.revokedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should allow only one concurrent request to consume the same reset token', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Request-Id', 'req-concurrent-1')
        .send({
          token: RAW_TOKEN,
          newPassword: 'NewPassword111'
        }),
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Request-Id', 'req-concurrent-2')
        .send({
          token: RAW_TOKEN,
          newPassword: 'NewPassword222'
        })
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(database.auditLogs).toHaveLength(1);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.usedAt).toBeInstanceOf(Date);
    for (const response of responses) {
      expectResponseNotToLeakResetData(response);
    }
  });

  function setCurrentToken(overrides: Partial<StoredPasswordResetToken>): void {
    const token = database.passwordResetTokens.find((storedToken) => storedToken.id === 'token-current');

    if (!token) {
      throw new Error('missing current token');
    }

    Object.assign(token, overrides);
  }

  function setUser(overrides: Partial<StoredUser>): void {
    const user = database.users.find((storedUser) => storedUser.id === 'user-1');

    if (!user) {
      throw new Error('missing user');
    }

    Object.assign(user, overrides);
  }
});

type StoredUser = {
  id: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  emailVerifiedAt: Date | null;
};

type StoredPasswordResetToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  requestedIpHash: string | null;
  createdAt: Date;
};

type StoredUserSession = {
  id: string;
  userId: string;
  revokedAt: Date | null;
  revokeReason: string | null;
};

type StoredRefreshToken = {
  id: string;
  sessionId: string;
  revokedAt: Date | null;
};

type StoredAuditLog = {
  actorUserId: string;
  targetUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
};

type InMemoryResetPasswordControllerDatabase = {
  users: StoredUser[];
  passwordResetTokens: StoredPasswordResetToken[];
  userSessions: StoredUserSession[];
  refreshTokens: StoredRefreshToken[];
  auditLogs: StoredAuditLog[];
  lockKeys: string[];
  prisma: {
    passwordResetToken: {
      findUnique: (args: { where: { tokenHash: string } }) => Promise<unknown>;
    };
    $transaction: <T>(callback: (transaction: InMemoryResetPasswordControllerTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryResetPasswordControllerTransaction = ReturnType<
  typeof createInMemoryResetPasswordControllerTransaction
>;

function createPasswordServiceMock() {
  return {
    hashPassword: vi.fn(async (password: string) => `hash:password:${password}`)
  };
}

async function createAuthResetPasswordApplication(
  database: InMemoryResetPasswordControllerDatabase,
  passwordService: ReturnType<typeof createPasswordServiceMock>,
  authConfig: AuthConfig
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      ResetPasswordService,
      PasswordResetRateLimitService,
      {
        provide: AUTH_CONFIG,
        useValue: authConfig
      },
      {
        provide: PrismaService,
        useValue: database.prisma
      },
      {
        provide: TokenHashService,
        useValue: {
          hashToken: vi.fn((token: string) => `hash:${token}`)
        }
      },
      {
        provide: PasswordService,
        useValue: passwordService
      },
      {
        provide: SessionService,
        useValue: {
          invalidateSessionCaches: vi.fn(async () => undefined)
        }
      },
      {
        provide: RegisterService,
        useValue: {
          register: vi.fn()
        }
      },
      {
        provide: EmailVerificationService,
        useValue: {
          verifyEmail: vi.fn()
        }
      },
      {
        provide: EmailVerificationResendService,
        useValue: {
          resendVerification: vi.fn()
        }
      },
      {
        provide: ForgotPasswordService,
        useValue: {
          forgotPassword: vi.fn()
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
        provide: LogoutService,
        useValue: {
          logout: vi.fn()
        }
      }
    ]
  }).compile();
  const nestApp = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false
  });
  applySafeBodyParser(nestApp);
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

function createInMemoryResetPasswordControllerDatabase(): InMemoryResetPasswordControllerDatabase {
  let transactionQueue = Promise.resolve();
  const database: InMemoryResetPasswordControllerDatabase = {
    users: [],
    passwordResetTokens: [],
    userSessions: [],
    refreshTokens: [],
    auditLogs: [],
    lockKeys: [],
    prisma: {
      passwordResetToken: {
        findUnique: async (args) => findPasswordResetTokenUnique(database, args, true)
      },
      $transaction: async <T>(callback: (transaction: InMemoryResetPasswordControllerTransaction) => Promise<T>) => {
        const run = async () => {
          const snapshot = cloneDatabase(database);

          try {
            const result = await callback(createInMemoryResetPasswordControllerTransaction(database));
            return result;
          } catch (error) {
            restoreDatabase(database, snapshot);
            throw error;
          }
        };
        const result = transactionQueue.then(run, run);
        transactionQueue = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      }
    }
  };

  return database;
}

function seedResetPasswordControllerDatabase(database: InMemoryResetPasswordControllerDatabase): void {
  database.users.push(createUser(), createUser({ id: 'user-2' }));
  database.passwordResetTokens.push(
    createResetToken(),
    createResetToken({
      id: 'token-peer-active',
      tokenHash: 'hash:peer-active'
    })
  );
  database.userSessions.push(createSession());
  database.refreshTokens.push(createRefreshToken());
}

function createInMemoryResetPasswordControllerTransaction(
  database: Omit<InMemoryResetPasswordControllerDatabase, 'prisma'>
) {
  return {
    $executeRaw: async (_strings: TemplateStringsArray, lockKey: string) => {
      database.lockKeys.push(lockKey);
      return 1;
    },
    passwordResetToken: {
      findUnique: async (args: { where: { tokenHash: string } }) =>
        findPasswordResetTokenUnique(database, args, false),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, Date> }) => {
        if (typeof where.id === 'string') {
          return updateCurrentPasswordResetToken(database, where, data);
        }

        return revokeOtherPasswordResetTokens(database, where, data);
      }
    },
    user: {
      update: async ({ where, data }: { where: { id: string }; data: { passwordHash: string } }) => {
        const user = database.users.find((storedUser) => storedUser.id === where.id);

        if (!user) {
          throw new Error('missing user');
        }

        user.passwordHash = data.passwordHash;
      }
    },
    userSession: {
      findMany: async ({ where }: { where: { userId: string; revokedAt: null } }) => {
        return database.userSessions
          .filter((session) => session.userId === where.userId && session.revokedAt === where.revokedAt)
          .map((session) => ({ id: session.id }));
      },
      updateMany: async ({
        where,
        data
      }: {
        where: { id: { in: string[] }; revokedAt: null };
        data: { revokedAt: Date; revokeReason: string };
      }) => {
        for (const session of database.userSessions) {
          if (where.id.in.includes(session.id) && session.revokedAt === where.revokedAt) {
            session.revokedAt = data.revokedAt;
            session.revokeReason = data.revokeReason;
          }
        }
      }
    },
    refreshToken: {
      updateMany: async ({
        where,
        data
      }: {
        where: { sessionId: { in: string[] }; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        for (const token of database.refreshTokens) {
          if (where.sessionId.in.includes(token.sessionId) && token.revokedAt === where.revokedAt) {
            token.revokedAt = data.revokedAt;
          }
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

async function findPasswordResetTokenUnique(
  database: Omit<InMemoryResetPasswordControllerDatabase, 'prisma'>,
  { where }: { where: { tokenHash: string } },
  isPreflight: boolean
) {
  const token = database.passwordResetTokens.find((storedToken) => storedToken.tokenHash === where.tokenHash);

  if (!token) {
    return null;
  }

  if (isPreflight) {
    return { id: token.id };
  }

  const user = database.users.find((storedUser) => storedUser.id === token.userId);

  return {
    id: token.id,
    userId: token.userId,
    expiresAt: token.expiresAt,
    usedAt: token.usedAt,
    revokedAt: token.revokedAt,
    user: user
      ? {
          id: user.id,
          isActive: user.isActive,
          emailVerifiedAt: user.emailVerifiedAt
        }
      : null
  };
}

function updateCurrentPasswordResetToken(
  database: Omit<InMemoryResetPasswordControllerDatabase, 'prisma'>,
  where: Record<string, unknown>,
  data: Record<string, Date>
) {
  let count = 0;
  const expiresAt = where.expiresAt as { gt: Date };

  for (const token of database.passwordResetTokens) {
    if (
      token.id === where.id &&
      token.usedAt === where.usedAt &&
      token.revokedAt === where.revokedAt &&
      token.expiresAt > expiresAt.gt
    ) {
      token.usedAt = data.usedAt;
      count += 1;
    }
  }

  return { count };
}

function revokeOtherPasswordResetTokens(
  database: Omit<InMemoryResetPasswordControllerDatabase, 'prisma'>,
  where: Record<string, unknown>,
  data: Record<string, Date>
) {
  let count = 0;
  const idFilter = where.id as { not: string };

  for (const token of database.passwordResetTokens) {
    if (
      token.userId === where.userId &&
      token.id !== idFilter.not &&
      token.usedAt === where.usedAt &&
      token.revokedAt === where.revokedAt
    ) {
      token.revokedAt = data.revokedAt;
      count += 1;
    }
  }

  return { count };
}

function createUser(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: overrides.id ?? 'user-1',
    passwordHash: overrides.passwordHash ?? 'old-password-hash',
    role: overrides.role ?? UserRole.USER,
    isActive: overrides.isActive ?? true,
    emailVerifiedAt:
      overrides.emailVerifiedAt === undefined
        ? new Date('2026-07-17T09:00:00.000Z')
        : overrides.emailVerifiedAt
  };
}

function createResetToken(overrides: Partial<StoredPasswordResetToken> = {}): StoredPasswordResetToken {
  return {
    id: overrides.id ?? 'token-current',
    userId: overrides.userId ?? 'user-1',
    tokenHash: overrides.tokenHash ?? TOKEN_HASH,
    expiresAt: overrides.expiresAt ?? new Date('2099-07-18T10:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    requestedIpHash: overrides.requestedIpHash ?? 'hash:ip:old',
    createdAt: overrides.createdAt ?? NOW
  };
}

function createSession(overrides: Partial<StoredUserSession> = {}): StoredUserSession {
  return {
    id: overrides.id ?? 'session-1',
    userId: overrides.userId ?? 'user-1',
    revokedAt: overrides.revokedAt ?? null,
    revokeReason: overrides.revokeReason ?? null
  };
}

function createRefreshToken(overrides: Partial<StoredRefreshToken> = {}): StoredRefreshToken {
  return {
    id: overrides.id ?? 'refresh-1',
    sessionId: overrides.sessionId ?? 'session-1',
    revokedAt: overrides.revokedAt ?? null
  };
}

function cloneDatabase(database: Omit<InMemoryResetPasswordControllerDatabase, 'prisma'>) {
  return {
    users: database.users.map((user) => ({ ...user })),
    passwordResetTokens: database.passwordResetTokens.map((token) => ({ ...token })),
    userSessions: database.userSessions.map((session) => ({ ...session })),
    refreshTokens: database.refreshTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log, metadata: { ...log.metadata } })),
    lockKeys: [...database.lockKeys]
  };
}

function restoreDatabase(
  database: Omit<InMemoryResetPasswordControllerDatabase, 'prisma'>,
  snapshot: ReturnType<typeof cloneDatabase>
): void {
  database.users = snapshot.users;
  database.passwordResetTokens = snapshot.passwordResetTokens;
  database.userSessions = snapshot.userSessions;
  database.refreshTokens = snapshot.refreshTokens;
  database.auditLogs = snapshot.auditLogs;
  // Advisory locks are external transaction effects; keep the call record visible to tests.
}

function expectResponseNotToLeakResetData(response: { body: unknown }): void {
  const serializedBody = JSON.stringify(response.body);

  expect(serializedBody).not.toContain(RAW_TOKEN);
  expect(serializedBody).not.toContain(TOKEN_HASH);
  expect(serializedBody).not.toContain('controller-secret-body');
  expect(serializedBody).not.toContain('refresh_token=');
  expect(serializedBody).not.toContain('token-current');
  expect(serializedBody).not.toContain('session-1');
  expect(serializedBody).not.toContain('refresh-1');
  expect(serializedBody).not.toContain('old-password-hash');
  expect(serializedBody).not.toContain('hash:password');
  expect(serializedBody).not.toContain('user-1');
  expect(serializedBody).not.toContain('Prisma');
  expect(serializedBody).not.toContain('database');
}

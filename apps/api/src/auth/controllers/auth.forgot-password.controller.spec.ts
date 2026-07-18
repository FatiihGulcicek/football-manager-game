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
import { FORGOT_PASSWORD_ACCEPTED_RESPONSE } from '../dto/forgot-password.dto';
import { EmailVerificationResendService } from '../services/email-verification-resend.service';
import { EmailVerificationService } from '../services/email-verification.service';
import {
  PASSWORD_RESET_DELIVERY_SERVICE,
  PasswordResetDeliveryService,
  SendPasswordResetEmailInput
} from '../services/password-reset-delivery.service';
import { PasswordResetRateLimitService } from '../services/password-reset-rate-limit.service';
import { ForgotPasswordService } from '../services/forgot-password.service';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshService } from '../services/refresh.service';
import { RegisterService } from '../services/register.service';
import { ResetPasswordService } from '../services/reset-password.service';
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

describe('AuthController forgot-password', () => {
  let app: INestApplication;
  let database: InMemoryForgotPasswordControllerDatabase;
  let sendPasswordResetEmail: ReturnType<typeof createSendPasswordResetEmailMock>;

  beforeEach(async () => {
    database = createInMemoryForgotPasswordControllerDatabase();
    seedForgotPasswordControllerDatabase(database);
    sendPasswordResetEmail = createSendPasswordResetEmailMock();
    app = await createAuthForgotPasswordApplication(
      database,
      { sendPasswordResetEmail } as PasswordResetDeliveryService,
      config
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('should accept a valid forgot-password request, rotate reset tokens, audit, and call safe delivery', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({
        email: 'user@example.invalid'
      })
      .expect(202);
    const setCookie = response.headers['set-cookie'];

    expect(response.body).toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);
    expect(setCookie).toBeUndefined();
    expect(database.passwordResetTokens.find((token) => token.id === 'token-old-active')?.revokedAt).toBeInstanceOf(
      Date
    );
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(activeTokens(database, 'user-1')[0]).toMatchObject({
      tokenHash: 'hash:raw-controller-reset-token-1',
      usedAt: null,
      revokedAt: null,
      requestedIpHash: 'hash:ip:127.0.0.1'
    });
    expect(JSON.stringify(database.passwordResetTokens)).not.toContain('"raw-controller-reset-token-1"');
    expect(database.auditLogs).toHaveLength(1);
    expect(database.auditLogs[0]).toMatchObject({
      action: AUTH_AUDIT_EVENTS.PASSWORD_RESET_REQUESTED,
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      metadata: {
        context: 'WEB',
        resetMethod: 'EMAIL_TOKEN'
      }
    });
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'user@example.invalid',
      rawToken: 'raw-controller-reset-token-1',
      expiresAt: expect.any(Date)
    });
    expect(database.userSessions).toHaveLength(0);
    expect(database.refreshTokens).toHaveLength(0);
    expectResponseNotToLeakResetData(response);
    expect(JSON.stringify(database.auditLogs)).not.toContain('raw-controller-reset-token-1');
    expect(JSON.stringify(database.auditLogs)).not.toContain('hash:raw-controller-reset-token-1');
  });

  it('should return the same 202 response for unknown, eligible, disabled, and unverified users', async () => {
    const eligibleResponse = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'user@example.invalid' })
      .expect(202);
    const unknownResponse = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'missing@example.invalid' })
      .expect(202);
    const disabledResponse = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'disabled@example.invalid' })
      .expect(202);
    const unverifiedResponse = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'unverified@example.invalid' })
      .expect(202);

    expect(unknownResponse.body).toEqual(eligibleResponse.body);
    expect(disabledResponse.body).toEqual(eligibleResponse.body);
    expect(unverifiedResponse.body).toEqual(eligibleResponse.body);
    expect(database.auditLogs).toHaveLength(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('should normalize uppercase and surrounding whitespace before matching email', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: '  USER@Example.INVALID  ' })
      .expect(202);

    expect(database.userLookupsByEmail).toContain('user@example.invalid');
    expect(database.auditLogs).toHaveLength(1);
  });

  it('should reject malformed email bodies before creating side effects', async () => {
    const oversizedEmail = `${'a'.repeat(245)}@example.invalid`;
    const cases: Array<Record<string, unknown>> = [
      {},
      { email: '' },
      { email: '   ' },
      { email: 'not-an-email' },
      { email: null },
      { email: ['user@example.invalid'] },
      { email: { value: 'user@example.invalid' } },
      { email: 123 },
      { email: oversizedEmail },
      { email: 'user@example.invalid', role: UserRole.ADMIN },
      { email: 'user@example.invalid\0' },
      { email: 'user@example.invalid\n' },
      { email: 'user@example.invalid\t' }
    ];

    for (const body of cases) {
      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send(body)
        .expect(400);

      expectResponseNotToLeakResetData(response);
    }

    expect(database.auditLogs).toHaveLength(0);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
  });

  it('should reject array and primitive bodies without reflecting raw request values', async () => {
    const arrayResponse = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send(['raw-controller-reset-token-1'])
      .expect(400);
    const primitiveResponse = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Content-Type', 'application/json')
      .send('"secret-reset-body"')
      .expect(400);
    const numericResponse = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Content-Type', 'application/json')
      .send('42')
      .expect(400);
    const malformedJsonResponse = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Content-Type', 'application/json')
      .send('{"email":"secret-reset-body"')
      .expect(400);

    expectResponseNotToLeakResetData(arrayResponse);
    expectResponseNotToLeakResetData(primitiveResponse);
    expectResponseNotToLeakResetData(numericResponse);
    expectResponseNotToLeakResetData(malformedJsonResponse);
    expect(malformedJsonResponse.body).toMatchObject({
      error: {
        code: 'INVALID_JSON_BODY',
        requestId: expect.any(String)
      }
    });
    expect(JSON.stringify(primitiveResponse.body)).not.toContain('secret-reset-body');
    expect(JSON.stringify(malformedJsonResponse.body)).not.toContain('secret-reset-body');
    expect(database.auditLogs).toHaveLength(0);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should not accept email from query, headers, cookies, or authorization', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password?email=user@example.invalid')
      .set('X-Email', 'user@example.invalid')
      .set('Authorization', 'Bearer user@example.invalid')
      .set('Cookie', 'email=user@example.invalid; refresh_token=raw-controller-reset-token-1')
      .send({})
      .expect(400);

    expect(database.auditLogs).toHaveLength(0);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
  });

  it('should leave disabled and unverified users without token, audit, or delivery side effects', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'disabled@example.invalid' })
      .expect(202);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'unverified@example.invalid' })
      .expect(202);

    expect(database.passwordResetTokens.find((token) => token.userId === 'disabled-user')?.revokedAt).toBeNull();
    expect(database.passwordResetTokens.find((token) => token.userId === 'unverified-user')?.revokedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("should keep another user's password reset token untouched", async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'user@example.invalid' })
      .expect(202);

    expect(database.passwordResetTokens.find((token) => token.id === 'token-other-user')?.revokedAt).toBeNull();
    expect(activeTokens(database, 'other-user')).toHaveLength(1);
  });

  it('should serialize three concurrent requests and leave one active reset token', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'user@example.invalid' }),
      request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'user@example.invalid' }),
      request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'user@example.invalid' })
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202, 202]);
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(activeTokens(database, 'user-1')[0].tokenHash).toBe('hash:raw-controller-reset-token-3');
    expect(database.auditLogs).toHaveLength(3);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(3);
    expect(database.lockKeys).toEqual([
      'auth-password-reset:user-1',
      'auth-password-reset:user-1',
      'auth-password-reset:user-1'
    ]);
  });

  it('should return generic accepted when the transaction fails and avoid delivery', async () => {
    database.failTransaction = true;

    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'user@example.invalid' })
      .expect(202);

    expect(response.body).toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should return generic accepted when delivery fails and keep the committed token', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('provider unavailable'));

    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'user@example.invalid' })
      .expect(202);

    expect(response.body).toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(1);
  });
});

type StoredUser = {
  id: string;
  email: string;
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

type StoredAuditLog = {
  actorUserId: string;
  targetUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, string>;
};

type InMemoryForgotPasswordControllerDatabase = {
  users: StoredUser[];
  passwordResetTokens: StoredPasswordResetToken[];
  auditLogs: StoredAuditLog[];
  userSessions: unknown[];
  refreshTokens: unknown[];
  userLookupsByEmail: string[];
  lockKeys: string[];
  completedTransactions: number;
  failTransaction: boolean;
  prisma: {
    user: {
      findUnique: (args: { where: { email?: string; id?: string } }) => Promise<unknown>;
    };
    $transaction: <T>(callback: (transaction: InMemoryForgotPasswordControllerTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryForgotPasswordControllerTransaction = ReturnType<
  typeof createInMemoryForgotPasswordControllerTransaction
>;

function createSendPasswordResetEmailMock() {
  return vi.fn(async (_input: SendPasswordResetEmailInput) => undefined);
}

async function createAuthForgotPasswordApplication(
  database: InMemoryForgotPasswordControllerDatabase,
  deliveryService: PasswordResetDeliveryService,
  authConfig: AuthConfig
): Promise<INestApplication> {
  let tokenCounter = 0;
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      ForgotPasswordService,
      {
        provide: ResetPasswordService,
        useValue: {
          resetPassword: vi.fn()
        }
      },
      PasswordResetRateLimitService,
      {
        provide: PASSWORD_RESET_DELIVERY_SERVICE,
        useValue: deliveryService
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
        provide: TokenHashService,
        useValue: {
          generateOpaqueToken: vi.fn(() => {
            tokenCounter += 1;
            return `raw-controller-reset-token-${tokenCounter}`;
          }),
          hashToken: vi.fn((token: string) => `hash:${token}`)
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

function createInMemoryForgotPasswordControllerDatabase(): InMemoryForgotPasswordControllerDatabase {
  let transactionQueue = Promise.resolve();
  const database: InMemoryForgotPasswordControllerDatabase = {
    users: [],
    passwordResetTokens: [],
    auditLogs: [],
    userSessions: [],
    refreshTokens: [],
    userLookupsByEmail: [],
    lockKeys: [],
    completedTransactions: 0,
    failTransaction: false,
    prisma: {
      user: {
        findUnique: async (args) => findUserUnique(database, args)
      },
      $transaction: async <T>(callback: (transaction: InMemoryForgotPasswordControllerTransaction) => Promise<T>) => {
        const run = async () => {
          if (database.failTransaction) {
            throw new Error('transaction failed');
          }

          const snapshot = cloneDatabase(database);

          try {
            const result = await callback(createInMemoryForgotPasswordControllerTransaction(database));
            database.completedTransactions += 1;
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

function seedForgotPasswordControllerDatabase(database: InMemoryForgotPasswordControllerDatabase): void {
  database.users.push(
    createUser(),
    createUser({
      id: 'disabled-user',
      email: 'disabled@example.invalid',
      isActive: false
    }),
    createUser({
      id: 'unverified-user',
      email: 'unverified@example.invalid',
      emailVerifiedAt: null
    }),
    createUser({
      id: 'other-user',
      email: 'other@example.invalid'
    })
  );
  database.passwordResetTokens.push(
    createResetToken({
      id: 'token-old-active',
      userId: 'user-1'
    }),
    createResetToken({
      id: 'token-disabled-user',
      userId: 'disabled-user'
    }),
    createResetToken({
      id: 'token-unverified-user',
      userId: 'unverified-user'
    }),
    createResetToken({
      id: 'token-other-user',
      userId: 'other-user'
    })
  );
}

async function findUserUnique(
  database: Omit<InMemoryForgotPasswordControllerDatabase, 'prisma'>,
  { where }: { where: { email?: string; id?: string } }
) {
  if (where.email) {
    database.userLookupsByEmail.push(where.email);
    const user = database.users.find((storedUser) => storedUser.email === where.email);
    return user ? { id: user.id } : null;
  }

  if (where.id) {
    const user = database.users.find((storedUser) => storedUser.id === where.id);

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      emailVerifiedAt: user.emailVerifiedAt
    };
  }

  return null;
}

function createInMemoryForgotPasswordControllerTransaction(
  database: Omit<InMemoryForgotPasswordControllerDatabase, 'prisma'>
) {
  return {
    $executeRaw: async (_strings: TemplateStringsArray, lockKey: string) => {
      database.lockKeys.push(lockKey);
      return 1;
    },
    user: {
      findUnique: async (args: { where: { email?: string; id?: string } }) => findUserUnique(database, args)
    },
    passwordResetToken: {
      updateMany: async ({
        where,
        data
      }: {
        where: { userId: string; usedAt: null; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        let count = 0;

        for (const token of database.passwordResetTokens) {
          if (token.userId === where.userId && token.usedAt === null && token.revokedAt === null) {
            token.revokedAt = data.revokedAt;
            count += 1;
          }
        }

        return { count };
      },
      create: async ({ data }: { data: Omit<StoredPasswordResetToken, 'id' | 'createdAt'> }) => {
        database.passwordResetTokens.push({
          id: `token-new-${database.passwordResetTokens.length}`,
          createdAt: new Date('2026-07-17T10:00:00.000Z'),
          ...data
        });
      }
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        database.auditLogs.push(data);
      }
    }
  };
}

function createUser(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: overrides.id ?? 'user-1',
    email: overrides.email ?? 'user@example.invalid',
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
    id: overrides.id ?? 'token-id',
    userId: overrides.userId ?? 'user-1',
    tokenHash: overrides.tokenHash ?? `hash:${overrides.id ?? 'old-token'}`,
    expiresAt: overrides.expiresAt ?? new Date('2026-07-18T10:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    requestedIpHash: overrides.requestedIpHash ?? 'hash:ip:old',
    createdAt: overrides.createdAt ?? new Date('2026-07-17T09:00:00.000Z')
  };
}

function activeTokens(
  database: InMemoryForgotPasswordControllerDatabase,
  userId: string
): StoredPasswordResetToken[] {
  return database.passwordResetTokens.filter(
    (token) => token.userId === userId && token.usedAt === null && token.revokedAt === null
  );
}

function cloneDatabase(database: Omit<InMemoryForgotPasswordControllerDatabase, 'prisma'>) {
  return {
    users: database.users.map((user) => ({ ...user })),
    passwordResetTokens: database.passwordResetTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log, metadata: { ...log.metadata } })),
    userSessions: [...database.userSessions],
    refreshTokens: [...database.refreshTokens],
    userLookupsByEmail: [...database.userLookupsByEmail],
    lockKeys: [...database.lockKeys],
    completedTransactions: database.completedTransactions,
    failTransaction: database.failTransaction
  };
}

function restoreDatabase(
  database: Omit<InMemoryForgotPasswordControllerDatabase, 'prisma'>,
  snapshot: ReturnType<typeof cloneDatabase>
): void {
  database.users = snapshot.users;
  database.passwordResetTokens = snapshot.passwordResetTokens;
  database.auditLogs = snapshot.auditLogs;
  database.userSessions = snapshot.userSessions;
  database.refreshTokens = snapshot.refreshTokens;
  database.userLookupsByEmail = snapshot.userLookupsByEmail;
  database.lockKeys = snapshot.lockKeys;
  database.completedTransactions = snapshot.completedTransactions;
  database.failTransaction = snapshot.failTransaction;
}

function expectResponseNotToLeakResetData(response: { body: unknown }): void {
  const serializedBody = JSON.stringify(response.body);

  expect(serializedBody).not.toContain('raw-controller-reset-token');
  expect(serializedBody).not.toContain('hash:raw-controller-reset-token');
  expect(serializedBody).not.toContain('refresh_token=raw-controller-reset-token');
  expect(serializedBody).not.toContain('secret-reset-body');
  expect(serializedBody).not.toContain('token-old-active');
  expect(serializedBody).not.toContain('token-new');
  expect(serializedBody).not.toContain('user-1');
  expect(serializedBody).not.toContain('Prisma');
  expect(serializedBody).not.toContain('database');
}

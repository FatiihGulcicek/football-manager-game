import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@football-manager/database';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { RESEND_VERIFICATION_ACCEPTED_RESPONSE } from '../dto/resend-verification.dto';
import {
  EMAIL_VERIFICATION_DELIVERY_SERVICE,
  EmailVerificationDeliveryService,
  SendVerificationEmailInput
} from '../services/email-verification-delivery.service';
import { EmailVerificationResendRateLimitService } from '../services/email-verification-resend-rate-limit.service';
import { EmailVerificationResendService } from '../services/email-verification-resend.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshService } from '../services/refresh.service';
import { RegisterService } from '../services/register.service';
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

describe('AuthController resend-verification', () => {
  let app: INestApplication;
  let database: InMemoryResendControllerDatabase;
  let sendVerificationEmail: ReturnType<typeof createSendVerificationEmailMock>;

  beforeEach(async () => {
    database = createInMemoryResendControllerDatabase();
    seedResendControllerDatabase(database);
    sendVerificationEmail = createSendVerificationEmailMock();
    app = await createAuthResendApplication(
      database,
      { sendVerificationEmail } as EmailVerificationDeliveryService,
      config
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('should accept a valid resend, revoke old tokens, create one hashed token, audit, and call safe delivery', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({
        email: 'user@example.invalid'
      })
      .expect(202);
    const setCookie = response.headers['set-cookie'];

    expect(response.body).toEqual(RESEND_VERIFICATION_ACCEPTED_RESPONSE);
    expect(setCookie).toBeUndefined();
    expect(database.emailVerificationTokens.find((token) => token.id === 'token-old-active')?.revokedAt).toBeInstanceOf(
      Date
    );
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(activeTokens(database, 'user-1')[0]).toMatchObject({
      tokenHash: 'hash:raw-controller-token-1',
      usedAt: null,
      revokedAt: null
    });
    expect(JSON.stringify(database.emailVerificationTokens)).not.toContain('"raw-controller-token-1"');
    expect(database.auditLogs).toHaveLength(1);
    expect(database.auditLogs[0]).toMatchObject({
      action: AUTH_AUDIT_EVENTS.EMAIL_VERIFICATION_RESENT,
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      metadata: {
        context: 'WEB',
        verificationMethod: 'TOKEN_RESEND'
      }
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'user@example.invalid',
      rawToken: 'raw-controller-token-1',
      expiresAt: expect.any(Date)
    });
    expect(database.userSessions).toHaveLength(0);
    expect(database.refreshTokens).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain('raw-controller-token-1');
    expect(JSON.stringify(response.body)).not.toContain('hash:raw-controller-token-1');
    expect(JSON.stringify(response.body)).not.toContain('user@example.invalid');
    expect(JSON.stringify(response.body)).not.toContain('user-1');
    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('refreshToken');
  });

  it('should return the same 202 response for unknown, verified, disabled, and eligible users', async () => {
    const eligibleResponse = await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'user@example.invalid' })
      .expect(202);
    const unknownResponse = await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'missing@example.invalid' })
      .expect(202);
    const verifiedResponse = await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'verified@example.invalid' })
      .expect(202);
    const disabledResponse = await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'disabled@example.invalid' })
      .expect(202);

    expect(unknownResponse.body).toEqual(eligibleResponse.body);
    expect(verifiedResponse.body).toEqual(eligibleResponse.body);
    expect(disabledResponse.body).toEqual(eligibleResponse.body);
    expect(database.auditLogs).toHaveLength(1);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('should normalize uppercase and surrounding whitespace before matching email', async () => {
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
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
      { email: 'user@example.invalid\n' }
    ];

    for (const body of cases) {
      const response = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send(body)
        .expect(400);

      expect(JSON.stringify(response.body)).not.toContain('raw-controller-token');
      expect(JSON.stringify(response.body)).not.toContain('hash:raw-controller-token');
    }

    expect(database.auditLogs).toHaveLength(0);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
  });

  it('should not accept email from query, header, or cookie', async () => {
    await request(app.getHttpServer())
      .post('/auth/resend-verification?email=user@example.invalid')
      .set('X-Email', 'user@example.invalid')
      .set('Cookie', 'email=user@example.invalid')
      .send({})
      .expect(400);

    expect(database.auditLogs).toHaveLength(0);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
  });

  it('should leave verified and disabled users without side effects', async () => {
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'verified@example.invalid' })
      .expect(202);
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'disabled@example.invalid' })
      .expect(202);

    expect(database.emailVerificationTokens.find((token) => token.userId === 'verified-user')?.revokedAt).toBeNull();
    expect(database.emailVerificationTokens.find((token) => token.userId === 'disabled-user')?.revokedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should keep another user token untouched when resending for one user', async () => {
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'user@example.invalid' })
      .expect(202);

    expect(database.emailVerificationTokens.find((token) => token.id === 'token-other-user')?.revokedAt).toBeNull();
    expect(activeTokens(database, 'other-user')).toHaveLength(1);
  });

  it('should serialize three concurrent requests and leave one active token', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'user@example.invalid' }),
      request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'user@example.invalid' }),
      request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'user@example.invalid' })
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202, 202]);
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(activeTokens(database, 'user-1')[0].tokenHash).toBe('hash:raw-controller-token-3');
    expect(database.auditLogs).toHaveLength(3);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(3);
    expect(database.lockKeys).toEqual([
      'auth-email-resend:user-1',
      'auth-email-resend:user-1',
      'auth-email-resend:user-1'
    ]);
  });
});

type StoredUser = {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  emailVerifiedAt: Date | null;
};

type StoredEmailVerificationToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
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

type InMemoryResendControllerDatabase = {
  users: StoredUser[];
  emailVerificationTokens: StoredEmailVerificationToken[];
  auditLogs: StoredAuditLog[];
  userSessions: unknown[];
  refreshTokens: unknown[];
  userLookupsByEmail: string[];
  lockKeys: string[];
  completedTransactions: number;
  prisma: {
    user: {
      findUnique: (args: { where: { email?: string; id?: string } }) => Promise<unknown>;
    };
    $transaction: <T>(callback: (transaction: InMemoryResendControllerTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryResendControllerTransaction = ReturnType<typeof createInMemoryResendControllerTransaction>;

function createSendVerificationEmailMock() {
  return vi.fn(async (_input: SendVerificationEmailInput) => undefined);
}

async function createAuthResendApplication(
  database: InMemoryResendControllerDatabase,
  deliveryService: EmailVerificationDeliveryService,
  authConfig: AuthConfig
): Promise<INestApplication> {
  let tokenCounter = 0;
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      EmailVerificationResendService,
      EmailVerificationResendRateLimitService,
      {
        provide: EMAIL_VERIFICATION_DELIVERY_SERVICE,
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
            return `raw-controller-token-${tokenCounter}`;
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
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  await app.init();
  return app;
}

function createInMemoryResendControllerDatabase(): InMemoryResendControllerDatabase {
  let transactionQueue = Promise.resolve();
  const database: InMemoryResendControllerDatabase = {
    users: [],
    emailVerificationTokens: [],
    auditLogs: [],
    userSessions: [],
    refreshTokens: [],
    userLookupsByEmail: [],
    lockKeys: [],
    completedTransactions: 0,
    prisma: {
      user: {
        findUnique: async (args) => findUserUnique(database, args)
      },
      $transaction: async <T>(callback: (transaction: InMemoryResendControllerTransaction) => Promise<T>) => {
        const run = async () => {
          const snapshot = cloneDatabase(database);

          try {
            const result = await callback(createInMemoryResendControllerTransaction(database));
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

function seedResendControllerDatabase(database: InMemoryResendControllerDatabase): void {
  database.users.push(
    createUser(),
    createUser({
      id: 'verified-user',
      email: 'verified@example.invalid',
      emailVerifiedAt: new Date('2026-07-17T09:00:00.000Z')
    }),
    createUser({
      id: 'disabled-user',
      email: 'disabled@example.invalid',
      isActive: false
    }),
    createUser({
      id: 'other-user',
      email: 'other@example.invalid'
    })
  );
  database.emailVerificationTokens.push(
    createVerificationToken({
      id: 'token-old-active',
      userId: 'user-1'
    }),
    createVerificationToken({
      id: 'token-verified-user',
      userId: 'verified-user'
    }),
    createVerificationToken({
      id: 'token-disabled-user',
      userId: 'disabled-user'
    }),
    createVerificationToken({
      id: 'token-other-user',
      userId: 'other-user'
    })
  );
}

async function findUserUnique(
  database: Omit<InMemoryResendControllerDatabase, 'prisma'>,
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

function createInMemoryResendControllerTransaction(
  database: Omit<InMemoryResendControllerDatabase, 'prisma'>
) {
  return {
    $executeRaw: async (_strings: TemplateStringsArray, lockKey: string) => {
      database.lockKeys.push(lockKey);
      return 1;
    },
    user: {
      findUnique: async (args: { where: { email?: string; id?: string } }) => findUserUnique(database, args)
    },
    emailVerificationToken: {
      updateMany: async ({
        where,
        data
      }: {
        where: { userId: string; usedAt: null; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        let count = 0;

        for (const token of database.emailVerificationTokens) {
          if (token.userId === where.userId && token.usedAt === null && token.revokedAt === null) {
            token.revokedAt = data.revokedAt;
            count += 1;
          }
        }

        return { count };
      },
      create: async ({ data }: { data: Omit<StoredEmailVerificationToken, 'id' | 'createdAt'> }) => {
        database.emailVerificationTokens.push({
          id: `token-new-${database.emailVerificationTokens.length}`,
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
    emailVerifiedAt: overrides.emailVerifiedAt ?? null
  };
}

function createVerificationToken(
  overrides: Partial<StoredEmailVerificationToken> = {}
): StoredEmailVerificationToken {
  return {
    id: overrides.id ?? 'token-id',
    userId: overrides.userId ?? 'user-1',
    tokenHash: overrides.tokenHash ?? `hash:${overrides.id ?? 'old-token'}`,
    expiresAt: overrides.expiresAt ?? new Date('2026-07-18T10:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-07-17T09:00:00.000Z')
  };
}

function activeTokens(
  database: InMemoryResendControllerDatabase,
  userId: string
): StoredEmailVerificationToken[] {
  return database.emailVerificationTokens.filter(
    (token) => token.userId === userId && token.usedAt === null && token.revokedAt === null
  );
}

function cloneDatabase(database: Omit<InMemoryResendControllerDatabase, 'prisma'>) {
  return {
    users: database.users.map((user) => ({ ...user })),
    emailVerificationTokens: database.emailVerificationTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log, metadata: { ...log.metadata } })),
    userSessions: [...database.userSessions],
    refreshTokens: [...database.refreshTokens],
    userLookupsByEmail: [...database.userLookupsByEmail],
    lockKeys: [...database.lockKeys],
    completedTransactions: database.completedTransactions
  };
}

function restoreDatabase(
  database: Omit<InMemoryResendControllerDatabase, 'prisma'>,
  snapshot: ReturnType<typeof cloneDatabase>
): void {
  database.users = snapshot.users;
  database.emailVerificationTokens = snapshot.emailVerificationTokens;
  database.auditLogs = snapshot.auditLogs;
  database.userSessions = snapshot.userSessions;
  database.refreshTokens = snapshot.refreshTokens;
  database.userLookupsByEmail = snapshot.userLookupsByEmail;
  database.lockKeys = snapshot.lockKeys;
  database.completedTransactions = snapshot.completedTransactions;
}

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@football-manager/database';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { EMAIL_VERIFIED_RESPONSE } from '../dto/verify-email.dto';
import {
  AUTH_EMAIL_VERIFICATION_INVALID_CODE,
  AUTH_EMAIL_VERIFICATION_INVALID_MESSAGE
} from '../errors/auth-email-verification-invalid.exception';
import { EmailVerificationRateLimitService } from '../services/email-verification-rate-limit.service';
import { EmailVerificationResendService } from '../services/email-verification-resend.service';
import { EmailVerificationService } from '../services/email-verification.service';
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

const VALID_INPUT = 'email-verify-controller-input-012345678901';
const SECOND_INPUT = 'email-verify-controller-input-222222222222';
const UNKNOWN_INPUT = 'email-verify-controller-input-unknown0000';
const NOW_AFTER_VERIFY = '2026-07-17T';

describe('AuthController verify-email', () => {
  let app: INestApplication;
  let database: InMemoryEmailVerificationDatabase;

  beforeEach(async () => {
    database = createInMemoryEmailVerificationDatabase();
    seedEmailVerificationDatabase(database);

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        EmailVerificationService,
        EmailVerificationRateLimitService,
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
          provide: ResetPasswordService,
          useValue: {
            resetPassword: vi.fn()
          }
        },
        {
          provide: AUTH_CONFIG,
          useValue: config
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
          provide: LogoutService,
          useValue: {
            logout: vi.fn()
          }
        }
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

  it('should verify email, consume the token, revoke superseded tokens, and write safe audit metadata', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({
        token: VALID_INPUT
      })
      .expect(200);

    expect(response.body).toEqual(EMAIL_VERIFIED_RESPONSE);
    expect(database.users[0].emailVerifiedAt?.toISOString()).toContain(NOW_AFTER_VERIFY);
    expect(database.emailVerificationTokens.find((token) => token.id === 'token-1')?.usedAt).toBeInstanceOf(Date);
    expect(database.emailVerificationTokens.find((token) => token.id === 'token-2')?.revokedAt).toBeInstanceOf(Date);
    expect(database.auditLogs).toHaveLength(1);
    expect(database.auditLogs[0]).toMatchObject({
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      action: AUTH_AUDIT_EVENTS.EMAIL_VERIFIED,
      entityType: 'User',
      entityId: 'user-1',
      metadata: {
        context: 'WEB',
        verificationMethod: 'TOKEN'
      }
    });
    expect(database.userSessions).toHaveLength(0);
    expect(database.refreshTokens).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain(VALID_INPUT);
    expect(JSON.stringify(database.auditLogs)).not.toContain(VALID_INPUT);
    expect(JSON.stringify(database.auditLogs)).not.toContain(`hash:${VALID_INPUT}`);
  });

  it('should consume a valid unused token even when the user is already verified', async () => {
    database.users[0].emailVerifiedAt = new Date('2026-07-16T10:00:00.000Z');

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({
        token: VALID_INPUT
      })
      .expect(200);

    expect(database.emailVerificationTokens.find((token) => token.id === 'token-1')?.usedAt).toBeInstanceOf(Date);
    expect(database.auditLogs).toHaveLength(1);
  });

  it('should return the generic invalid envelope when the same token is used twice', async () => {
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({
        token: VALID_INPUT
      })
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .set('X-Request-Id', 'req-used-token')
      .send({
        token: VALID_INPUT
      })
      .expect(400);

    expectInvalidEnvelope(response.body, 'req-used-token');
    expect(database.auditLogs).toHaveLength(1);
  });

  it('should return the same generic response for unknown, expired, revoked, used, and disabled-user tokens', async () => {
    database.emailVerificationTokens.push(
      createVerificationToken({
        id: 'expired-token',
        tokenHash: 'hash:expired-token-input-012345678901',
        expiresAt: new Date('2026-07-16T10:00:00.000Z')
      }),
      createVerificationToken({
        id: 'revoked-token',
        tokenHash: 'hash:revoked-token-input-012345678901',
        revokedAt: new Date('2026-07-16T10:00:00.000Z')
      }),
      createVerificationToken({
        id: 'used-token',
        tokenHash: 'hash:used-token-input-012345678901',
        usedAt: new Date('2026-07-16T10:00:00.000Z')
      }),
      createVerificationToken({
        id: 'disabled-user-token',
        userId: 'user-2',
        tokenHash: 'hash:disabled-user-input-012345678901'
      })
    );
    database.users.push(createUser({ id: 'user-2', isActive: false }));
    const cases = [
      UNKNOWN_INPUT,
      'expired-token-input-012345678901',
      'revoked-token-input-012345678901',
      'used-token-input-012345678901',
      'disabled-user-input-012345678901'
    ];

    for (const tokenInput of cases) {
      const response = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .set('X-Request-Id', 'req-generic-invalid')
        .send({
          token: tokenInput
        })
        .expect(400);

      expectInvalidEnvelope(response.body, 'req-generic-invalid');
    }

    expect(database.auditLogs).toHaveLength(0);
  });

  it('should not accept tokens from query or headers', async () => {
    const response = await request(app.getHttpServer())
      .post(`/auth/verify-email?token=${VALID_INPUT}`)
      .set('X-Verify-Token', VALID_INPUT)
      .set('X-Request-Id', 'req-query-header')
      .send({})
      .expect(400);

    expectInvalidEnvelope(response.body, 'req-query-header');
    expect(database.emailVerificationTokens.find((token) => token.id === 'token-1')?.usedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should reject extra auth-controlled body fields with the generic envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .set('X-Request-Id', 'req-extra-fields')
      .send({
        token: VALID_INPUT,
        role: UserRole.ADMIN,
        userId: 'user-2'
      })
      .expect(400);

    expectInvalidEnvelope(response.body, 'req-extra-fields');
    expect(database.emailVerificationTokens.find((token) => token.id === 'token-1')?.usedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should allow only one of two concurrent verify requests to consume the token', async () => {
    const [firstResponse, secondResponse] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/verify-email')
        .set('X-Request-Id', 'req-concurrent-1')
        .send({ token: VALID_INPUT }),
      request(app.getHttpServer())
        .post('/auth/verify-email')
        .set('X-Request-Id', 'req-concurrent-2')
        .send({ token: VALID_INPUT })
    ]);
    const statuses = [firstResponse.status, secondResponse.status].sort();
    const invalidResponse = [firstResponse, secondResponse].find((response) => response.status === 400);

    expect(statuses).toEqual([200, 400]);
    expect(invalidResponse).toBeDefined();
    expect(invalidResponse?.body.error.code).toBe(AUTH_EMAIL_VERIFICATION_INVALID_CODE);
    expect(database.auditLogs).toHaveLength(1);
    expect(database.emailVerificationTokens.find((token) => token.id === 'token-1')?.usedAt).toBeInstanceOf(Date);
  });

  it('should not affect another user verification token', async () => {
    database.users.push(createUser({ id: 'user-2', email: 'other@example.invalid' }));
    database.emailVerificationTokens.push(
      createVerificationToken({
        id: 'token-other-user',
        userId: 'user-2',
        tokenHash: `hash:${SECOND_INPUT}`
      })
    );

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({
        token: VALID_INPUT
      })
      .expect(200);

    expect(database.emailVerificationTokens.find((token) => token.id === 'token-other-user')?.usedAt).toBeNull();
    expect(database.emailVerificationTokens.find((token) => token.id === 'token-other-user')?.revokedAt).toBeNull();
    expect(database.users.find((user) => user.id === 'user-2')?.emailVerifiedAt).toBeNull();
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

type InMemoryEmailVerificationDatabase = {
  users: StoredUser[];
  emailVerificationTokens: StoredEmailVerificationToken[];
  auditLogs: StoredAuditLog[];
  userSessions: unknown[];
  refreshTokens: unknown[];
  prisma: {
    $transaction: <T>(callback: (transaction: InMemoryEmailVerificationTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryEmailVerificationTransaction = ReturnType<typeof createInMemoryEmailVerificationTransaction>;

function createInMemoryEmailVerificationDatabase(): InMemoryEmailVerificationDatabase {
  const database = {
    users: [] as StoredUser[],
    emailVerificationTokens: [] as StoredEmailVerificationToken[],
    auditLogs: [] as StoredAuditLog[],
    userSessions: [] as unknown[],
    refreshTokens: [] as unknown[],
    prisma: {
      $transaction: async <T>(callback: (transaction: InMemoryEmailVerificationTransaction) => Promise<T>) => {
        const snapshot = cloneDatabase(database);

        try {
          return await callback(createInMemoryEmailVerificationTransaction(database));
        } catch (error) {
          restoreDatabase(database, snapshot);
          throw error;
        }
      }
    }
  };

  return database;
}

function seedEmailVerificationDatabase(database: InMemoryEmailVerificationDatabase): void {
  database.users.push(createUser());
  database.emailVerificationTokens.push(
    createVerificationToken({
      id: 'token-1',
      tokenHash: `hash:${VALID_INPUT}`
    }),
    createVerificationToken({
      id: 'token-2',
      tokenHash: `hash:${SECOND_INPUT}`
    })
  );
}

function createInMemoryEmailVerificationTransaction(
  database: Omit<InMemoryEmailVerificationDatabase, 'prisma'>
) {
  return {
    emailVerificationToken: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const token = database.emailVerificationTokens.find(
          (storedToken) => storedToken.tokenHash === where.tokenHash
        );

        if (!token) {
          return null;
        }

        const user = database.users.find((storedUser) => storedUser.id === token.userId) ?? null;

        return {
          id: token.id,
          userId: token.userId,
          expiresAt: token.expiresAt,
          usedAt: token.usedAt,
          revokedAt: token.revokedAt,
          user: user
            ? {
                id: user.id,
                isActive: user.isActive
              }
            : null
        };
      },
      updateMany: async ({
        where,
        data
      }: {
        where: {
          id?: string | { not: string };
          userId?: string;
          usedAt: null;
          revokedAt: null;
          expiresAt?: { gt: Date };
        };
        data: {
          usedAt?: Date;
          revokedAt?: Date;
        };
      }) => {
        let count = 0;

        for (const token of database.emailVerificationTokens) {
          if (!matchesTokenWhere(token, where)) {
            continue;
          }

          if (data.usedAt) {
            token.usedAt = data.usedAt;
          }

          if (data.revokedAt) {
            token.revokedAt = data.revokedAt;
          }

          count += 1;
        }

        return { count };
      }
    },
    user: {
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: { emailVerifiedAt: Date };
      }) => {
        const user = database.users.find((storedUser) => storedUser.id === where.id);

        if (!user) {
          throw new Error('User not found');
        }

        user.emailVerifiedAt = data.emailVerifiedAt;
      }
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        database.auditLogs.push(data);
      }
    }
  };
}

function matchesTokenWhere(
  token: StoredEmailVerificationToken,
  where: {
    id?: string | { not: string };
    userId?: string;
    usedAt: null;
    revokedAt: null;
    expiresAt?: { gt: Date };
  }
): boolean {
  if (typeof where.id === 'string' && token.id !== where.id) {
    return false;
  }

  if (typeof where.id === 'object' && token.id === where.id.not) {
    return false;
  }

  if (where.userId && token.userId !== where.userId) {
    return false;
  }

  if (token.usedAt !== null || token.revokedAt !== null) {
    return false;
  }

  if (where.expiresAt && token.expiresAt <= where.expiresAt.gt) {
    return false;
  }

  return true;
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
    tokenHash: overrides.tokenHash ?? `hash:${VALID_INPUT}`,
    expiresAt: overrides.expiresAt ?? new Date('2026-07-18T10:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-07-17T10:00:00.000Z')
  };
}

function expectInvalidEnvelope(body: unknown, requestId: string): void {
  expect(body).toEqual({
    error: {
      code: AUTH_EMAIL_VERIFICATION_INVALID_CODE,
      message: AUTH_EMAIL_VERIFICATION_INVALID_MESSAGE,
      requestId
    }
  });
}

function cloneDatabase(database: Omit<InMemoryEmailVerificationDatabase, 'prisma'>) {
  return {
    users: database.users.map((user) => ({ ...user })),
    emailVerificationTokens: database.emailVerificationTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log, metadata: { ...log.metadata } })),
    userSessions: [...database.userSessions],
    refreshTokens: [...database.refreshTokens]
  };
}

function restoreDatabase(
  database: Omit<InMemoryEmailVerificationDatabase, 'prisma'>,
  snapshot: ReturnType<typeof cloneDatabase>
): void {
  database.users = snapshot.users;
  database.emailVerificationTokens = snapshot.emailVerificationTokens;
  database.auditLogs = snapshot.auditLogs;
  database.userSessions = snapshot.userSessions;
  database.refreshTokens = snapshot.refreshTokens;
}

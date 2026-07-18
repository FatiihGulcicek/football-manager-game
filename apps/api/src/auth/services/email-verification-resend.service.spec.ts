import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@football-manager/database';
import { describe, expect, it, vi } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { RESEND_VERIFICATION_ACCEPTED_RESPONSE } from '../dto/resend-verification.dto';
import {
  EmailVerificationDeliveryService,
  SendVerificationEmailInput
} from './email-verification-delivery.service';
import { EmailVerificationResendRateLimitService } from './email-verification-resend-rate-limit.service';
import { EmailVerificationResendService } from './email-verification-resend.service';
import { TokenHashService } from './token-hash.service';

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

describe('EmailVerificationResendService', () => {
  it('should normalize email before lookup and use the generic accepted response', async () => {
    const { database, service } = createHarness();

    await expect(
      service.resendVerification({ email: '  USER@Example.INVALID  ' }, { requestId: 'req-normalize' }, NOW)
    ).resolves.toEqual(RESEND_VERIFICATION_ACCEPTED_RESPONSE);

    expect(database.userLookupsByEmail).toEqual(['user@example.invalid']);
  });

  it('should return generic accepted for an unknown user without side effects', async () => {
    const { database, deliveryService, service } = createHarness({ seedEligibleUser: false });

    await expect(
      service.resendVerification({ email: 'missing@example.invalid' }, { requestId: 'req-missing' }, NOW)
    ).resolves.toEqual(RESEND_VERIFICATION_ACCEPTED_RESPONSE);

    expect(database.transactionsStarted).toBe(0);
    expect(database.emailVerificationTokens).toHaveLength(0);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should return generic accepted for a disabled user without token, audit, or delivery side effects', async () => {
    const { database, deliveryService, service } = createHarness({
      user: { isActive: false }
    });

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-disabled' }, NOW);

    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.emailVerificationTokens[0].revokedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should return generic accepted for an already verified user without side effects', async () => {
    const { database, deliveryService, service } = createHarness({
      user: { emailVerifiedAt: new Date('2026-07-17T09:00:00.000Z') }
    });

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-verified' }, NOW);

    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should revoke old unused tokens before creating a new active token for an eligible user', async () => {
    const { database, service } = createHarness();

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-eligible' }, NOW);

    expect(database.emailVerificationTokens.find((token) => token.id === 'token-old-active')?.revokedAt).toEqual(NOW);
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(activeTokens(database, 'user-1')[0].tokenHash).toBe('hash:raw-resend-token-1');
  });

  it('should create a token with the configured verification expiry', async () => {
    const { database, service } = createHarness();

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-expiry' }, NOW);

    const newToken = activeTokens(database, 'user-1')[0];
    expect(newToken.expiresAt.toISOString()).toBe('2026-07-18T10:00:00.000Z');
    expect(newToken.usedAt).toBeNull();
    expect(newToken.revokedAt).toBeNull();
  });

  it('should store only the token hash and never write the raw token to the database', async () => {
    const { database, tokenHashService, service } = createHarness();

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-hash' }, NOW);

    expect(tokenHashService.hashToken).toHaveBeenCalledWith('raw-resend-token-1');
    expect(JSON.stringify(database.emailVerificationTokens)).toContain('hash:raw-resend-token-1');
    expect(JSON.stringify(database.emailVerificationTokens)).not.toContain('"raw-resend-token-1"');
  });

  it('should write the expected audit event only for a created resend token', async () => {
    const { database, service } = createHarness();

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-audit' }, NOW);

    expect(database.auditLogs).toHaveLength(1);
    expect(database.auditLogs[0]).toMatchObject({
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      action: AUTH_AUDIT_EVENTS.EMAIL_VERIFICATION_RESENT,
      entityType: 'User',
      entityId: 'user-1'
    });
  });

  it('should keep audit metadata on the explicit allowlist', async () => {
    const { database, service } = createHarness();

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-audit-safe' }, NOW);

    expect(database.auditLogs[0].metadata).toEqual({
      context: 'WEB',
      verificationMethod: 'TOKEN_RESEND'
    });
    expect(JSON.stringify(database.auditLogs)).not.toContain('user@example.invalid');
    expect(JSON.stringify(database.auditLogs)).not.toContain('raw-resend-token-1');
    expect(JSON.stringify(database.auditLogs)).not.toContain('hash:raw-resend-token-1');
  });

  it('should call mail delivery after the transaction commits and pass the raw token only to delivery', async () => {
    const { database, deliveryService, service } = createHarness();
    deliveryService.sendVerificationEmail.mockImplementation(async (input) => {
      expect(database.completedTransactions).toBe(1);
      expect(input).toMatchObject({
        userId: 'user-1',
        email: 'user@example.invalid',
        rawToken: 'raw-resend-token-1',
        expiresAt: new Date('2026-07-18T10:00:00.000Z')
      });
    });

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-delivery' }, NOW);

    expect(deliveryService.sendVerificationEmail).toHaveBeenCalledOnce();
  });

  it('should never include raw token, token hash, email, or user id in the response', async () => {
    const { service } = createHarness();

    const response = await service.resendVerification(
      { email: 'user@example.invalid' },
      { requestId: 'req-response' },
      NOW
    );
    const serializedResponse = JSON.stringify(response);

    expect(response).toEqual(RESEND_VERIFICATION_ACCEPTED_RESPONSE);
    expect(serializedResponse).not.toContain('raw-resend-token-1');
    expect(serializedResponse).not.toContain('hash:raw-resend-token-1');
    expect(serializedResponse).not.toContain('user@example.invalid');
    expect(serializedResponse).not.toContain('user-1');
  });

  it('should call the rate-limit boundary with a hashed email and normalized request context', async () => {
    const { rateLimitService, service } = createHarness();

    await service.resendVerification(
      { email: '  USER@Example.INVALID  ' },
      { requestId: ' req-rate ', clientIp: ' 127.0.0.1 ' },
      NOW
    );

    expect(rateLimitService.consumeResendVerificationAttempt).toHaveBeenCalledWith({
      emailHash: 'hash:resend-email:user@example.invalid',
      clientIp: '127.0.0.1',
      requestId: 'req-rate'
    });
    expect(JSON.stringify(rateLimitService.consumeResendVerificationAttempt.mock.calls)).not.toContain(
      '"user@example.invalid"'
    );
  });

  it('should use a user-scoped advisory lock inside the transaction', async () => {
    const { database, service } = createHarness();

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-lock' }, NOW);

    expect(database.lockKeys).toEqual(['auth-email-resend:user-1']);
  });

  it('should roll back revoked tokens when token creation fails', async () => {
    const { database, deliveryService, service } = createHarness({ failTokenCreate: true });

    await expect(
      service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-token-fail' }, NOW)
    ).rejects.toThrow('token create failed');

    expect(database.emailVerificationTokens.find((token) => token.id === 'token-old-active')?.revokedAt).toBeNull();
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should roll back revoked and newly created tokens when audit creation fails', async () => {
    const { database, deliveryService, service } = createHarness({ failAuditCreate: true });

    await expect(
      service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-audit-fail' }, NOW)
    ).rejects.toThrow('audit create failed');

    expect(database.emailVerificationTokens.find((token) => token.id === 'token-old-active')?.revokedAt).toBeNull();
    expect(database.emailVerificationTokens).toHaveLength(1);
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should return generic accepted when delivery fails without rolling back the committed token', async () => {
    const { database, deliveryService, service } = createHarness();
    deliveryService.sendVerificationEmail.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-delivery-fail' }, NOW)
    ).resolves.toEqual(RESEND_VERIFICATION_ACCEPTED_RESPONSE);

    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(1);
  });

  it("should not affect another user's verification tokens", async () => {
    const { database, service } = createHarness();
    database.users.push(createUser({ id: 'user-2', email: 'other@example.invalid' }));
    database.emailVerificationTokens.push(
      createVerificationToken({
        id: 'token-other-user',
        userId: 'user-2',
        tokenHash: 'hash:other-token'
      })
    );

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-other-user' }, NOW);

    expect(database.emailVerificationTokens.find((token) => token.id === 'token-other-user')?.revokedAt).toBeNull();
    expect(activeTokens(database, 'user-2')).toHaveLength(1);
  });

  it('should skip side effects if the user email changes after the initial lookup', async () => {
    const { database, deliveryService, service } = createHarness();
    database.beforeTransaction = () => {
      database.users[0].email = 'changed@example.invalid';
    };

    await service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-changed' }, NOW);

    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should reject malformed service DTOs before side effects', async () => {
    const { database, service } = createHarness();

    await expect(
      service.resendVerification(
        { email: 'user@example.invalid', role: UserRole.ADMIN } as never,
        { requestId: 'req-extra' },
        NOW
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(database.transactionsStarted).toBe(0);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should serialize concurrent resends so only the latest token remains active', async () => {
    const { database, deliveryService, service } = createHarness();

    await Promise.all([
      service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-concurrent-1' }, NOW),
      service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-concurrent-2' }, NOW),
      service.resendVerification({ email: 'user@example.invalid' }, { requestId: 'req-concurrent-3' }, NOW)
    ]);

    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(activeTokens(database, 'user-1')[0].tokenHash).toBe('hash:raw-resend-token-3');
    expect(database.auditLogs).toHaveLength(3);
    expect(deliveryService.sendVerificationEmail).toHaveBeenCalledTimes(3);
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

type InMemoryResendDatabase = {
  users: StoredUser[];
  emailVerificationTokens: StoredEmailVerificationToken[];
  auditLogs: StoredAuditLog[];
  userLookupsByEmail: string[];
  lockKeys: string[];
  transactionsStarted: number;
  completedTransactions: number;
  failTokenCreate: boolean;
  failAuditCreate: boolean;
  beforeTransaction?: () => void;
  prisma: {
    user: {
      findUnique: FindUserUnique;
    };
    $transaction: <T>(callback: (transaction: InMemoryResendTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryResendTransaction = ReturnType<typeof createInMemoryResendTransaction>;
type FindUserUnique = (args: { where: { email?: string; id?: string } }) => Promise<unknown>;

type HarnessOptions = {
  seedEligibleUser?: boolean;
  user?: Partial<StoredUser>;
  failTokenCreate?: boolean;
  failAuditCreate?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const database = createInMemoryResendDatabase(options);
  let tokenCounter = 0;
  const tokenHashService = {
    generateOpaqueToken: vi.fn(() => {
      tokenCounter += 1;
      return `raw-resend-token-${tokenCounter}`;
    }),
    hashToken: vi.fn((token: string) => `hash:${token}`)
  };
  const rateLimitService = {
    consumeResendVerificationAttempt: vi.fn(async () => undefined)
  };
  const deliveryService = {
    sendVerificationEmail: vi.fn(async (_input: SendVerificationEmailInput) => undefined)
  };
  const service = new EmailVerificationResendService(
    database.prisma as unknown as PrismaService,
    tokenHashService as unknown as TokenHashService,
    rateLimitService as unknown as EmailVerificationResendRateLimitService,
    deliveryService as unknown as EmailVerificationDeliveryService,
    config
  );

  return {
    database,
    tokenHashService,
    rateLimitService,
    deliveryService,
    service
  };
}

function createInMemoryResendDatabase(options: HarnessOptions): InMemoryResendDatabase {
  let transactionQueue = Promise.resolve();
  const database: InMemoryResendDatabase = {
    users: [],
    emailVerificationTokens: [],
    auditLogs: [],
    userLookupsByEmail: [],
    lockKeys: [],
    transactionsStarted: 0,
    completedTransactions: 0,
    failTokenCreate: options.failTokenCreate ?? false,
    failAuditCreate: options.failAuditCreate ?? false,
    prisma: {
      user: {
        findUnique: async (args) => findUserUnique(database, args)
      },
      $transaction: async <T>(callback: (transaction: InMemoryResendTransaction) => Promise<T>) => {
        const run = async () => {
          database.beforeTransaction?.();
          database.transactionsStarted += 1;
          const snapshot = cloneDatabase(database);

          try {
            const result = await callback(createInMemoryResendTransaction(database));
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

  if (options.seedEligibleUser !== false) {
    database.users.push(createUser(options.user));
    database.emailVerificationTokens.push(createVerificationToken());
  }

  return database;
}

async function findUserUnique(
  database: Omit<InMemoryResendDatabase, 'prisma'>,
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

function createInMemoryResendTransaction(database: Omit<InMemoryResendDatabase, 'prisma'>) {
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
        if (database.failTokenCreate) {
          throw new Error('token create failed');
        }

        database.emailVerificationTokens.push({
          id: `token-new-${database.emailVerificationTokens.length}`,
          createdAt: NOW,
          ...data
        });
      }
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        if (database.failAuditCreate) {
          throw new Error('audit create failed');
        }

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
    id: overrides.id ?? 'token-old-active',
    userId: overrides.userId ?? 'user-1',
    tokenHash: overrides.tokenHash ?? 'hash:old-token',
    expiresAt: overrides.expiresAt ?? new Date('2026-07-18T09:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-07-17T09:00:00.000Z')
  };
}

function activeTokens(database: InMemoryResendDatabase, userId: string): StoredEmailVerificationToken[] {
  return database.emailVerificationTokens.filter(
    (token) => token.userId === userId && token.usedAt === null && token.revokedAt === null
  );
}

function cloneDatabase(database: Omit<InMemoryResendDatabase, 'prisma'>) {
  return {
    users: database.users.map((user) => ({ ...user })),
    emailVerificationTokens: database.emailVerificationTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log, metadata: { ...log.metadata } })),
    userLookupsByEmail: [...database.userLookupsByEmail],
    lockKeys: [...database.lockKeys],
    transactionsStarted: database.transactionsStarted,
    completedTransactions: database.completedTransactions
  };
}

function restoreDatabase(
  database: Omit<InMemoryResendDatabase, 'prisma'>,
  snapshot: ReturnType<typeof cloneDatabase>
): void {
  database.users = snapshot.users;
  database.emailVerificationTokens = snapshot.emailVerificationTokens;
  database.auditLogs = snapshot.auditLogs;
  database.userLookupsByEmail = snapshot.userLookupsByEmail;
  database.lockKeys = snapshot.lockKeys;
  database.transactionsStarted = snapshot.transactionsStarted;
  database.completedTransactions = snapshot.completedTransactions;
}

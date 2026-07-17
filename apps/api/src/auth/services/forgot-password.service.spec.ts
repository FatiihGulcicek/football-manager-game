import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@football-manager/database';
import { describe, expect, it, vi } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { FORGOT_PASSWORD_ACCEPTED_RESPONSE } from '../dto/forgot-password.dto';
import {
  PasswordResetDeliveryService,
  SendPasswordResetEmailInput
} from './password-reset-delivery.service';
import { PasswordResetRateLimitService } from './password-reset-rate-limit.service';
import { ForgotPasswordService } from './forgot-password.service';
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

describe('ForgotPasswordService', () => {
  it('should normalize email before lookup and use the generic accepted response', async () => {
    const { database, service } = createHarness();

    await expect(
      service.forgotPassword(
        { email: '  USER@Example.INVALID  ' },
        { requestId: 'req-normalize' },
        NOW
      )
    ).resolves.toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);

    expect(database.userLookupsByEmail).toEqual(['user@example.invalid']);
  });

  it('should call the rate-limit boundary for every valid request before user lookup', async () => {
    const { database, rateLimitService, service } = createHarness({ seedEligibleUser: false });
    rateLimitService.consumeForgotPasswordAttempt.mockImplementation(async () => {
      expect(database.userLookupsByEmail).toHaveLength(0);
    });

    await service.forgotPassword(
      { email: '  MISSING@Example.INVALID  ' },
      { requestId: ' req-rate ', clientIp: ' 127.0.0.1 ' },
      NOW
    );

    expect(rateLimitService.consumeForgotPasswordAttempt).toHaveBeenCalledWith({
      emailHash: 'hash:password-reset-email:missing@example.invalid',
      clientIp: '127.0.0.1',
      requestId: 'req-rate'
    });
    expect(JSON.stringify(rateLimitService.consumeForgotPasswordAttempt.mock.calls)).not.toContain(
      '"missing@example.invalid"'
    );
  });

  it('should return generic accepted for an unknown user without side effects', async () => {
    const { database, deliveryService, service } = createHarness({ seedEligibleUser: false });

    await expect(
      service.forgotPassword(
        { email: 'missing@example.invalid' },
        { requestId: 'req-missing' },
        NOW
      )
    ).resolves.toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);

    expect(database.transactionsStarted).toBe(0);
    expect(database.passwordResetTokens).toHaveLength(0);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should return generic accepted for disabled and unverified users without side effects', async () => {
    const disabled = createHarness({
      user: {
        isActive: false
      }
    });
    await disabled.service.forgotPassword(
      { email: 'user@example.invalid' },
      { requestId: 'req-disabled' },
      NOW
    );

    expect(activeTokens(disabled.database, 'user-1')).toHaveLength(1);
    expect(disabled.database.passwordResetTokens[0].revokedAt).toBeNull();
    expect(disabled.database.auditLogs).toHaveLength(0);
    expect(disabled.deliveryService.sendPasswordResetEmail).not.toHaveBeenCalled();

    const unverified = createHarness({
      user: {
        emailVerifiedAt: null
      }
    });
    await unverified.service.forgotPassword(
      { email: 'user@example.invalid' },
      { requestId: 'req-unverified' },
      NOW
    );

    expect(activeTokens(unverified.database, 'user-1')).toHaveLength(1);
    expect(unverified.database.auditLogs).toHaveLength(0);
    expect(unverified.deliveryService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should revoke all old unused tokens before creating one active reset token', async () => {
    const { database, service } = createHarness({
      extraTokens: [
        createResetToken({
          id: 'token-expired-unused',
          tokenHash: 'hash:expired-unused',
          expiresAt: new Date('2026-07-16T10:00:00.000Z')
        }),
        createResetToken({
          id: 'token-used',
          tokenHash: 'hash:used',
          usedAt: new Date('2026-07-17T09:00:00.000Z')
        }),
        createResetToken({
          id: 'token-revoked',
          tokenHash: 'hash:revoked',
          revokedAt: new Date('2026-07-17T09:00:00.000Z')
        })
      ]
    });

    await service.forgotPassword(
      { email: 'user@example.invalid' },
      { requestId: 'req-eligible' },
      NOW
    );

    expect(database.passwordResetTokens.find((token) => token.id === 'token-old-active')?.revokedAt).toEqual(NOW);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-expired-unused')?.revokedAt).toEqual(NOW);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-used')?.revokedAt).toBeNull();
    expect(database.passwordResetTokens.find((token) => token.id === 'token-revoked')?.revokedAt).toEqual(
      new Date('2026-07-17T09:00:00.000Z')
    );
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(activeTokens(database, 'user-1')[0].tokenHash).toBe('hash:raw-reset-token-1');
  });

  it('should create a token with the configured password-reset expiry and requested IP hash', async () => {
    const { database, service } = createHarness();

    await service.forgotPassword(
      { email: 'user@example.invalid' },
      { requestId: 'req-expiry', clientIp: '198.51.100.42' },
      NOW
    );

    const newToken = activeTokens(database, 'user-1')[0];
    expect(newToken.expiresAt.toISOString()).toBe('2026-07-17T10:30:00.000Z');
    expect(newToken.requestedIpHash).toBe('hash:ip:198.51.100.42');
    expect(newToken.usedAt).toBeNull();
    expect(newToken.revokedAt).toBeNull();
  });

  it('should store only the token hash and never write the raw reset token to the database', async () => {
    const { database, tokenHashService, service } = createHarness();

    await service.forgotPassword({ email: 'user@example.invalid' }, { requestId: 'req-hash' }, NOW);

    expect(tokenHashService.hashToken).toHaveBeenCalledWith('raw-reset-token-1');
    expect(JSON.stringify(database.passwordResetTokens)).toContain('hash:raw-reset-token-1');
    expect(JSON.stringify(database.passwordResetTokens)).not.toContain('"raw-reset-token-1"');
  });

  it('should write the expected audit event only for an eligible reset token creation', async () => {
    const { database, service } = createHarness();

    await service.forgotPassword({ email: 'user@example.invalid' }, { requestId: 'req-audit' }, NOW);

    expect(database.auditLogs).toHaveLength(1);
    expect(database.auditLogs[0]).toMatchObject({
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      action: AUTH_AUDIT_EVENTS.PASSWORD_RESET_REQUESTED,
      entityType: 'User',
      entityId: 'user-1',
      metadata: {
        context: 'WEB',
        resetMethod: 'EMAIL_TOKEN'
      }
    });
  });

  it('should keep audit metadata on the explicit allowlist', async () => {
    const { database, service } = createHarness();

    await service.forgotPassword({ email: 'user@example.invalid' }, { requestId: 'req-audit-safe' }, NOW);

    expect(database.auditLogs[0].metadata).toEqual({
      context: 'WEB',
      resetMethod: 'EMAIL_TOKEN'
    });
    expect(JSON.stringify(database.auditLogs)).not.toContain('user@example.invalid');
    expect(JSON.stringify(database.auditLogs)).not.toContain('raw-reset-token-1');
    expect(JSON.stringify(database.auditLogs)).not.toContain('hash:raw-reset-token-1');
    expect(JSON.stringify(database.auditLogs)).not.toContain('198.51.100');
    expect(JSON.stringify(database.auditLogs)).not.toContain('token-new');
  });

  it('should call delivery after the transaction commits and pass the raw token only to delivery', async () => {
    const { database, deliveryService, service } = createHarness();
    deliveryService.sendPasswordResetEmail.mockImplementation(async (input) => {
      expect(database.completedTransactions).toBe(1);
      expect(input).toEqual({
        userId: 'user-1',
        email: 'user@example.invalid',
        rawToken: 'raw-reset-token-1',
        expiresAt: new Date('2026-07-17T10:30:00.000Z')
      });
    });

    await service.forgotPassword({ email: 'user@example.invalid' }, { requestId: 'req-delivery' }, NOW);

    expect(deliveryService.sendPasswordResetEmail).toHaveBeenCalledOnce();
  });

  it('should return generic accepted when delivery fails without rolling back the committed token', async () => {
    const { database, deliveryService, service } = createHarness();
    deliveryService.sendPasswordResetEmail.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.forgotPassword(
        { email: 'user@example.invalid' },
        { requestId: 'req-delivery-fail' },
        NOW
      )
    ).resolves.toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);

    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(1);
  });

  it('should never include raw token, token hash, email, or user id in the response', async () => {
    const { service } = createHarness();

    const response = await service.forgotPassword(
      { email: 'user@example.invalid' },
      { requestId: 'req-response' },
      NOW
    );
    const serializedResponse = JSON.stringify(response);

    expect(response).toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);
    expect(serializedResponse).not.toContain('raw-reset-token-1');
    expect(serializedResponse).not.toContain('hash:raw-reset-token-1');
    expect(serializedResponse).not.toContain('user@example.invalid');
    expect(serializedResponse).not.toContain('user-1');
  });

  it('should use a purpose-separated user-scoped advisory lock inside the transaction', async () => {
    const { database, service } = createHarness();

    await service.forgotPassword({ email: 'user@example.invalid' }, { requestId: 'req-lock' }, NOW);

    expect(database.lockKeys).toEqual(['auth-password-reset:user-1']);
  });

  it('should roll back revoked tokens when token creation fails and still return generic accepted', async () => {
    const { database, deliveryService, service } = createHarness({ failTokenCreate: true });

    await expect(
      service.forgotPassword(
        { email: 'user@example.invalid' },
        { requestId: 'req-token-fail' },
        NOW
      )
    ).resolves.toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);

    expect(database.passwordResetTokens.find((token) => token.id === 'token-old-active')?.revokedAt).toBeNull();
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should roll back revoked and new tokens when audit creation fails and still return generic accepted', async () => {
    const { database, deliveryService, service } = createHarness({ failAuditCreate: true });

    await expect(
      service.forgotPassword(
        { email: 'user@example.invalid' },
        { requestId: 'req-audit-fail' },
        NOW
      )
    ).resolves.toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);

    expect(database.passwordResetTokens.find((token) => token.id === 'token-old-active')?.revokedAt).toBeNull();
    expect(database.passwordResetTokens).toHaveLength(1);
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should return generic accepted for transaction failures after the candidate lookup', async () => {
    const { database, deliveryService, service } = createHarness({ failTransaction: true });

    await expect(
      service.forgotPassword(
        { email: 'user@example.invalid' },
        { requestId: 'req-transaction-fail' },
        NOW
      )
    ).resolves.toEqual(FORGOT_PASSWORD_ACCEPTED_RESPONSE);

    expect(database.transactionsStarted).toBe(1);
    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should propagate an initial candidate lookup outage as the normal infrastructure error', async () => {
    const { service } = createHarness({ failInitialUserLookup: true });

    await expect(
      service.forgotPassword(
        { email: 'user@example.invalid' },
        { requestId: 'req-user-lookup-fail' },
        NOW
      )
    ).rejects.toThrow('candidate lookup failed');
  });

  it("should not affect another user's password reset tokens", async () => {
    const { database, service } = createHarness();
    database.users.push(createUser({ id: 'user-2', email: 'other@example.invalid' }));
    database.passwordResetTokens.push(
      createResetToken({
        id: 'token-other-user',
        userId: 'user-2',
        tokenHash: 'hash:other-token'
      })
    );

    await service.forgotPassword({ email: 'user@example.invalid' }, { requestId: 'req-other-user' }, NOW);

    expect(database.passwordResetTokens.find((token) => token.id === 'token-other-user')?.revokedAt).toBeNull();
    expect(activeTokens(database, 'user-2')).toHaveLength(1);
  });

  it('should skip side effects if the user email changes after the initial lookup', async () => {
    const { database, deliveryService, service } = createHarness();
    database.beforeTransaction = () => {
      database.users[0].email = 'changed@example.invalid';
    };

    await service.forgotPassword({ email: 'user@example.invalid' }, { requestId: 'req-changed' }, NOW);

    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(0);
    expect(deliveryService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should reject malformed service DTOs before side effects', async () => {
    const { database, service } = createHarness();

    await expect(
      service.forgotPassword(
        { email: 'user@example.invalid', role: UserRole.ADMIN } as never,
        { requestId: 'req-extra' },
        NOW
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.forgotPassword({ email: 'user@example.invalid\0' }, { requestId: 'req-null' }, NOW)
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(database.transactionsStarted).toBe(0);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should serialize concurrent reset requests so only the latest token remains active', async () => {
    const { database, deliveryService, service } = createHarness();

    await Promise.all([
      service.forgotPassword(
        { email: 'user@example.invalid' },
        { requestId: 'req-concurrent-1' },
        NOW
      ),
      service.forgotPassword(
        { email: 'user@example.invalid' },
        { requestId: 'req-concurrent-2' },
        NOW
      ),
      service.forgotPassword(
        { email: 'user@example.invalid' },
        { requestId: 'req-concurrent-3' },
        NOW
      )
    ]);

    expect(activeTokens(database, 'user-1')).toHaveLength(1);
    expect(activeTokens(database, 'user-1')[0].tokenHash).toBe('hash:raw-reset-token-3');
    expect(database.auditLogs).toHaveLength(3);
    expect(deliveryService.sendPasswordResetEmail).toHaveBeenCalledTimes(3);
    expect(database.lockKeys).toEqual([
      'auth-password-reset:user-1',
      'auth-password-reset:user-1',
      'auth-password-reset:user-1'
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

type InMemoryForgotPasswordDatabase = {
  users: StoredUser[];
  passwordResetTokens: StoredPasswordResetToken[];
  auditLogs: StoredAuditLog[];
  userLookupsByEmail: string[];
  lockKeys: string[];
  transactionsStarted: number;
  completedTransactions: number;
  failTokenCreate: boolean;
  failAuditCreate: boolean;
  failTransaction: boolean;
  failInitialUserLookup: boolean;
  beforeTransaction?: () => void;
  prisma: {
    user: {
      findUnique: FindUserUnique;
    };
    $transaction: <T>(callback: (transaction: InMemoryForgotPasswordTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryForgotPasswordTransaction = ReturnType<typeof createInMemoryForgotPasswordTransaction>;
type FindUserUnique = (args: { where: { email?: string; id?: string } }) => Promise<unknown>;

type HarnessOptions = {
  seedEligibleUser?: boolean;
  user?: Partial<StoredUser>;
  extraTokens?: StoredPasswordResetToken[];
  failTokenCreate?: boolean;
  failAuditCreate?: boolean;
  failTransaction?: boolean;
  failInitialUserLookup?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const database = createInMemoryForgotPasswordDatabase(options);
  let tokenCounter = 0;
  const tokenHashService = {
    generateOpaqueToken: vi.fn(() => {
      tokenCounter += 1;
      return `raw-reset-token-${tokenCounter}`;
    }),
    hashToken: vi.fn((token: string) => `hash:${token}`)
  };
  const rateLimitService = {
    consumeForgotPasswordAttempt: vi.fn(async () => undefined)
  };
  const deliveryService = {
    sendPasswordResetEmail: vi.fn(async (_input: SendPasswordResetEmailInput) => undefined)
  };
  const service = new ForgotPasswordService(
    database.prisma as unknown as PrismaService,
    tokenHashService as unknown as TokenHashService,
    rateLimitService as unknown as PasswordResetRateLimitService,
    deliveryService as unknown as PasswordResetDeliveryService,
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

function createInMemoryForgotPasswordDatabase(
  options: HarnessOptions
): InMemoryForgotPasswordDatabase {
  let transactionQueue = Promise.resolve();
  const database: InMemoryForgotPasswordDatabase = {
    users: [],
    passwordResetTokens: [],
    auditLogs: [],
    userLookupsByEmail: [],
    lockKeys: [],
    transactionsStarted: 0,
    completedTransactions: 0,
    failTokenCreate: options.failTokenCreate ?? false,
    failAuditCreate: options.failAuditCreate ?? false,
    failTransaction: options.failTransaction ?? false,
    failInitialUserLookup: options.failInitialUserLookup ?? false,
    prisma: {
      user: {
        findUnique: async (args) => findUserUnique(database, args)
      },
      $transaction: async <T>(callback: (transaction: InMemoryForgotPasswordTransaction) => Promise<T>) => {
        const run = async () => {
          database.beforeTransaction?.();
          database.transactionsStarted += 1;

          if (database.failTransaction) {
            throw new Error('transaction failed');
          }

          const snapshot = cloneDatabase(database);

          try {
            const result = await callback(createInMemoryForgotPasswordTransaction(database));
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
    database.passwordResetTokens.push(createResetToken());
    database.passwordResetTokens.push(...(options.extraTokens ?? []));
  }

  return database;
}

async function findUserUnique(
  database: Omit<InMemoryForgotPasswordDatabase, 'prisma'>,
  { where }: { where: { email?: string; id?: string } }
) {
  if (where.email) {
    if (database.failInitialUserLookup) {
      throw new Error('candidate lookup failed');
    }

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

function createInMemoryForgotPasswordTransaction(
  database: Omit<InMemoryForgotPasswordDatabase, 'prisma'>
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
        if (database.failTokenCreate) {
          throw new Error('token create failed');
        }

        database.passwordResetTokens.push({
          id: `token-new-${database.passwordResetTokens.length}`,
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
    emailVerifiedAt:
      overrides.emailVerifiedAt === undefined
        ? new Date('2026-07-17T09:00:00.000Z')
        : overrides.emailVerifiedAt
  };
}

function createResetToken(overrides: Partial<StoredPasswordResetToken> = {}): StoredPasswordResetToken {
  return {
    id: overrides.id ?? 'token-old-active',
    userId: overrides.userId ?? 'user-1',
    tokenHash: overrides.tokenHash ?? 'hash:old-reset-token',
    expiresAt: overrides.expiresAt ?? new Date('2026-07-18T09:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    requestedIpHash: overrides.requestedIpHash ?? 'hash:ip:old',
    createdAt: overrides.createdAt ?? new Date('2026-07-17T09:00:00.000Z')
  };
}

function activeTokens(
  database: InMemoryForgotPasswordDatabase,
  userId: string
): StoredPasswordResetToken[] {
  return database.passwordResetTokens.filter(
    (token) => token.userId === userId && token.usedAt === null && token.revokedAt === null
  );
}

function cloneDatabase(database: Omit<InMemoryForgotPasswordDatabase, 'prisma'>) {
  return {
    users: database.users.map((user) => ({ ...user })),
    passwordResetTokens: database.passwordResetTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log, metadata: { ...log.metadata } })),
    userLookupsByEmail: [...database.userLookupsByEmail],
    lockKeys: [...database.lockKeys],
    transactionsStarted: database.transactionsStarted,
    completedTransactions: database.completedTransactions
  };
}

function restoreDatabase(
  database: Omit<InMemoryForgotPasswordDatabase, 'prisma'>,
  snapshot: ReturnType<typeof cloneDatabase>
): void {
  database.users = snapshot.users;
  database.passwordResetTokens = snapshot.passwordResetTokens;
  database.auditLogs = snapshot.auditLogs;
  database.userLookupsByEmail = snapshot.userLookupsByEmail;
  database.lockKeys = snapshot.lockKeys;
  database.transactionsStarted = snapshot.transactionsStarted;
  database.completedTransactions = snapshot.completedTransactions;
}

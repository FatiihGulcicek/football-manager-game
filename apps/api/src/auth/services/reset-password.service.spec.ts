import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@football-manager/database';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { RESET_PASSWORD_SUCCESS_RESPONSE } from '../dto/reset-password.dto';
import {
  AUTH_RESET_PASSWORD_INVALID_CODE,
  AuthResetPasswordInvalidException
} from '../errors/auth-reset-password-invalid.exception';
import { PasswordResetRateLimitService } from './password-reset-rate-limit.service';
import { PasswordService, PasswordValidationError } from './password.service';
import { ResetPasswordService } from './reset-password.service';
import { SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

const NOW = new Date('2026-07-17T10:00:00.000Z');
const RAW_TOKEN = 'reset_token_fixture_00000000000000000001';
const TOKEN_HASH = `hash:${RAW_TOKEN}`;
const NEW_PASSWORD = 'NewPassword123';

describe('ResetPasswordService', () => {
  it('should reset password, consume the current token, revoke peer tokens, revoke sessions and audit once', async () => {
    const { database, service, sessionService } = createHarness({
      extraTokens: [
        createResetToken({
          id: 'token-peer-active',
          tokenHash: 'hash:peer-active'
        }),
        createResetToken({
          id: 'token-peer-expired-unused',
          tokenHash: 'hash:peer-expired-unused',
          expiresAt: new Date('2026-07-16T10:00:00.000Z')
        }),
        createResetToken({
          id: 'token-peer-used',
          tokenHash: 'hash:peer-used',
          usedAt: new Date('2026-07-17T09:00:00.000Z')
        }),
        createResetToken({
          id: 'token-peer-revoked',
          tokenHash: 'hash:peer-revoked',
          revokedAt: new Date('2026-07-17T09:00:00.000Z')
        }),
        createResetToken({
          id: 'token-other-user',
          userId: 'user-2',
          tokenHash: 'hash:other-user'
        })
      ],
      sessions: [
        createSession({ id: 'session-1' }),
        createSession({ id: 'session-2' }),
        createSession({
          id: 'session-already-revoked',
          revokedAt: new Date('2026-07-17T09:00:00.000Z')
        }),
        createSession({ id: 'session-other-user', userId: 'user-2' })
      ],
      refreshTokens: [
        createRefreshToken({ id: 'refresh-1', sessionId: 'session-1' }),
        createRefreshToken({ id: 'refresh-2', sessionId: 'session-2' }),
        createRefreshToken({
          id: 'refresh-already-revoked',
          sessionId: 'session-1',
          revokedAt: new Date('2026-07-17T09:00:00.000Z')
        }),
        createRefreshToken({ id: 'refresh-other-user', sessionId: 'session-other-user' })
      ]
    });

    await expect(
      service.resetPassword(
        { token: RAW_TOKEN, newPassword: NEW_PASSWORD },
        { requestId: 'req-reset', clientIp: '198.51.100.24' },
        NOW
      )
    ).resolves.toEqual(RESET_PASSWORD_SUCCESS_RESPONSE);

    expect(database.users.find((user) => user.id === 'user-1')?.passwordHash).toBe('hash:password:NewPassword123');
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.usedAt).toEqual(NOW);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.revokedAt).toBeNull();
    expect(database.passwordResetTokens.find((token) => token.id === 'token-peer-active')?.revokedAt).toEqual(NOW);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-peer-expired-unused')?.revokedAt).toEqual(
      NOW
    );
    expect(database.passwordResetTokens.find((token) => token.id === 'token-peer-used')?.revokedAt).toBeNull();
    expect(database.passwordResetTokens.find((token) => token.id === 'token-peer-revoked')?.revokedAt).toEqual(
      new Date('2026-07-17T09:00:00.000Z')
    );
    expect(database.passwordResetTokens.find((token) => token.id === 'token-other-user')?.revokedAt).toBeNull();
    expect(database.userSessions.find((session) => session.id === 'session-1')?.revokedAt).toEqual(NOW);
    expect(database.userSessions.find((session) => session.id === 'session-1')?.revokeReason).toBe('PASSWORD_RESET');
    expect(database.userSessions.find((session) => session.id === 'session-2')?.revokedAt).toEqual(NOW);
    expect(database.userSessions.find((session) => session.id === 'session-other-user')?.revokedAt).toBeNull();
    expect(database.refreshTokens.find((token) => token.id === 'refresh-1')?.revokedAt).toEqual(NOW);
    expect(database.refreshTokens.find((token) => token.id === 'refresh-2')?.revokedAt).toEqual(NOW);
    expect(database.refreshTokens.find((token) => token.id === 'refresh-other-user')?.revokedAt).toBeNull();
    expect(database.auditLogs).toEqual([
      {
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.PASSWORD_RESET_COMPLETED,
        entityType: 'User',
        entityId: 'user-1',
        metadata: {
          context: 'WEB',
          resetMethod: 'EMAIL_TOKEN',
          sessionsRevoked: true
        }
      }
    ]);
    expect(database.lockKeys).toEqual([`auth-password-reset-consume:${TOKEN_HASH}`]);
    expect(sessionService.invalidateSessionCaches).toHaveBeenCalledWith(['session-1', 'session-2']);
    expect(JSON.stringify(database.auditLogs)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(database.auditLogs)).not.toContain(TOKEN_HASH);
  });

  it('should call the reset rate-limit boundary before preflight lookup without raw token leakage', async () => {
    const { database, rateLimitService, service } = createHarness();
    rateLimitService.consumeResetPasswordAttempt.mockImplementation(async () => {
      expect(database.preflightTokenLookups).toHaveLength(0);
    });

    await service.resetPassword(
      { token: RAW_TOKEN, newPassword: NEW_PASSWORD },
      { requestId: ' req-rate ', clientIp: ' 203.0.113.10 ' },
      NOW
    );

    expect(rateLimitService.consumeResetPasswordAttempt).toHaveBeenCalledWith({
      tokenHash: TOKEN_HASH,
      clientIp: '203.0.113.10',
      requestId: 'req-rate'
    });
    expect(JSON.stringify(rateLimitService.consumeResetPasswordAttempt.mock.calls)).not.toContain(
      `"${RAW_TOKEN}"`
    );
  });

  it('should reject unknown tokens before password hashing or transaction work', async () => {
    const { database, passwordService, service } = createHarness({ seedCurrentToken: false });

    await expect(
      service.resetPassword(
        { token: RAW_TOKEN, newPassword: NEW_PASSWORD },
        { requestId: 'req-unknown' },
        NOW
      )
    ).rejects.toBeInstanceOf(AuthResetPasswordInvalidException);

    expect(passwordService.hashPassword).not.toHaveBeenCalled();
    expect(database.transactionsStarted).toBe(0);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should return the same generic invalid-token envelope for token-state and user-state failures', async () => {
    const cases: Array<[string, HarnessOptions]> = [
      [
        'expired',
        {
          token: {
            expiresAt: NOW
          }
        }
      ],
      [
        'used',
        {
          token: {
            usedAt: new Date('2026-07-17T09:00:00.000Z')
          }
        }
      ],
      [
        'revoked',
        {
          token: {
            revokedAt: new Date('2026-07-17T09:00:00.000Z')
          }
        }
      ],
      [
        'missing user',
        {
          seedUser: false
        }
      ],
      [
        'disabled user',
        {
          user: {
            isActive: false
          }
        }
      ],
      [
        'unverified user',
        {
          user: {
            emailVerifiedAt: null
          }
        }
      ],
      [
        'race-consumed token',
        {
          currentTokenConsumeCountZero: true
        }
      ]
    ];

    for (const [, options] of cases) {
      const { database, service } = createHarness(options);

      try {
        await service.resetPassword(
          { token: RAW_TOKEN, newPassword: NEW_PASSWORD },
          { requestId: 'req-invalid-state' },
          NOW
        );
        throw new Error('Expected resetPassword to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthResetPasswordInvalidException);
        expect((error as AuthResetPasswordInvalidException).getResponse()).toMatchObject({
          error: {
            code: AUTH_RESET_PASSWORD_INVALID_CODE,
            requestId: 'req-invalid-state'
          }
        });
      }

      const user = database.users.find((storedUser) => storedUser.id === 'user-1');

      if (user) {
        expect(user.passwordHash).toBe('old-password-hash');
      }
      expect(database.auditLogs).toHaveLength(0);
    }
  });

  it('should use PasswordResetToken only and not accept an email-verification token with the same raw value', async () => {
    const { database, service } = createHarness({ seedCurrentToken: false });
    database.emailVerificationTokens.push({
      id: 'email-token-1',
      userId: 'user-1',
      tokenHash: TOKEN_HASH,
      expiresAt: new Date('2026-07-18T10:00:00.000Z'),
      usedAt: null,
      revokedAt: null,
      createdAt: NOW
    });

    await expect(
      service.resetPassword(
        { token: RAW_TOKEN, newPassword: NEW_PASSWORD },
        { requestId: 'req-purpose' },
        NOW
      )
    ).rejects.toBeInstanceOf(AuthResetPasswordInvalidException);

    expect(database.transactionsStarted).toBe(0);
    expect(database.emailVerificationTokens[0].usedAt).toBeNull();
  });

  it('should hash the password outside the transaction and leave the token unconsumed on password validation failure', async () => {
    const { database, passwordService, service } = createHarness();
    passwordService.hashPassword.mockImplementation(async () => {
      expect(database.transactionsStarted).toBe(0);
      throw new PasswordValidationError('weak password');
    });

    await expect(
      service.resetPassword({ token: RAW_TOKEN, newPassword: 'weak' }, { requestId: 'req-weak' }, NOW)
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(database.transactionsStarted).toBe(0);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.usedAt).toBeNull();
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should reject malformed service DTOs before side effects', async () => {
    const { database, service } = createHarness();
    const cases: unknown[] = [
      null,
      [],
      {},
      { token: '', newPassword: NEW_PASSWORD },
      { token: '   ', newPassword: NEW_PASSWORD },
      { token: 'short', newPassword: NEW_PASSWORD },
      { token: `${RAW_TOKEN}\n`, newPassword: NEW_PASSWORD },
      { token: RAW_TOKEN, newPassword: null },
      { token: RAW_TOKEN, newPassword: NEW_PASSWORD, role: UserRole.ADMIN }
    ];

    for (const dto of cases) {
      await expect(
        service.resetPassword(dto as never, { requestId: 'req-malformed' }, NOW)
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(database.preflightTokenLookups).toHaveLength(0);
    expect(database.transactionsStarted).toBe(0);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should serialize concurrent reset attempts so only one succeeds and one audit event is written', async () => {
    const { database, service } = createHarness({
      sessions: [createSession({ id: 'session-1' })],
      refreshTokens: [createRefreshToken({ id: 'refresh-1', sessionId: 'session-1' })]
    });

    const results = await Promise.allSettled([
      service.resetPassword(
        { token: RAW_TOKEN, newPassword: 'NewPassword111' },
        { requestId: 'req-concurrent-1' },
        NOW
      ),
      service.resetPassword(
        { token: RAW_TOKEN, newPassword: 'NewPassword222' },
        { requestId: 'req-concurrent-2' },
        NOW
      ),
      service.resetPassword(
        { token: RAW_TOKEN, newPassword: 'NewPassword333' },
        { requestId: 'req-concurrent-3' },
        NOW
      )
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);
    expect(database.passwordResetTokens.find((token) => token.id === 'token-current')?.usedAt).toEqual(NOW);
    expect(database.userSessions.find((session) => session.id === 'session-1')?.revokedAt).toEqual(NOW);
    expect(database.refreshTokens.find((token) => token.id === 'refresh-1')?.revokedAt).toEqual(NOW);
    expect(database.auditLogs).toHaveLength(1);
    expect(database.users.find((user) => user.id === 'user-1')?.passwordHash).toBe('hash:password:NewPassword111');
    expect(database.lockKeys).toEqual([
      `auth-password-reset-consume:${TOKEN_HASH}`,
      `auth-password-reset-consume:${TOKEN_HASH}`,
      `auth-password-reset-consume:${TOKEN_HASH}`
    ]);
  });

  it('should roll back every mutation when transaction-side writes fail', async () => {
    const cases: HarnessFailureFlag[] = [
      'failPasswordUpdate',
      'failCurrentTokenConsume',
      'failOtherTokenRevoke',
      'failSessionRevoke',
      'failRefreshTokenRevoke',
      'failAuditCreate',
      'failTransaction'
    ];

    for (const flag of cases) {
      const { database, service } = createHarness({
        [flag]: true,
        extraTokens: [createResetToken({ id: 'token-peer-active', tokenHash: 'hash:peer-active' })],
        sessions: [createSession({ id: 'session-1' })],
        refreshTokens: [createRefreshToken({ id: 'refresh-1', sessionId: 'session-1' })]
      });
      const snapshot = cloneDatabase(database);

      await expect(
        service.resetPassword(
          { token: RAW_TOKEN, newPassword: NEW_PASSWORD },
          { requestId: `req-${flag}` },
          NOW
        )
      ).rejects.toThrow();

      expect(sanitizeForComparison(database)).toEqual(sanitizeForComparison(snapshot));
    }
  });
});

type StoredUser = {
  id: string;
  email: string;
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

type StoredEmailVerificationToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
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

type InMemoryResetPasswordDatabase = {
  users: StoredUser[];
  passwordResetTokens: StoredPasswordResetToken[];
  emailVerificationTokens: StoredEmailVerificationToken[];
  userSessions: StoredUserSession[];
  refreshTokens: StoredRefreshToken[];
  auditLogs: StoredAuditLog[];
  lockKeys: string[];
  preflightTokenLookups: string[];
  transactionsStarted: number;
  completedTransactions: number;
  failPasswordUpdate: boolean;
  failCurrentTokenConsume: boolean;
  failOtherTokenRevoke: boolean;
  failSessionRevoke: boolean;
  failRefreshTokenRevoke: boolean;
  failAuditCreate: boolean;
  failTransaction: boolean;
  currentTokenConsumeCountZero: boolean;
  prisma: {
    passwordResetToken: {
      findUnique: (args: { where: { tokenHash: string } }) => Promise<unknown>;
    };
    $transaction: <T>(callback: (transaction: InMemoryResetPasswordTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryResetPasswordTransaction = ReturnType<typeof createInMemoryResetPasswordTransaction>;

type HarnessFailureFlag =
  | 'failPasswordUpdate'
  | 'failCurrentTokenConsume'
  | 'failOtherTokenRevoke'
  | 'failSessionRevoke'
  | 'failRefreshTokenRevoke'
  | 'failAuditCreate'
  | 'failTransaction';

type HarnessOptions = Partial<Record<HarnessFailureFlag, boolean>> & {
  seedUser?: boolean;
  seedCurrentToken?: boolean;
  user?: Partial<StoredUser>;
  token?: Partial<StoredPasswordResetToken>;
  extraTokens?: StoredPasswordResetToken[];
  sessions?: StoredUserSession[];
  refreshTokens?: StoredRefreshToken[];
  currentTokenConsumeCountZero?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const database = createInMemoryResetPasswordDatabase(options);
  const tokenHashService = {
    hashToken: vi.fn((token: string) => `hash:${token}`)
  };
  const passwordService = {
    hashPassword: vi.fn(async (password: string) => `hash:password:${password}`)
  };
  const rateLimitService = {
    consumeResetPasswordAttempt: vi.fn(async () => undefined)
  };
  const sessionService = {
    invalidateSessionCaches: vi.fn(async () => undefined)
  };
  const service = new ResetPasswordService(
    database.prisma as unknown as PrismaService,
    tokenHashService as unknown as TokenHashService,
    passwordService as unknown as PasswordService,
    rateLimitService as unknown as PasswordResetRateLimitService,
    sessionService as unknown as SessionService
  );

  return {
    database,
    tokenHashService,
    passwordService,
    rateLimitService,
    sessionService,
    service
  };
}

function createInMemoryResetPasswordDatabase(options: HarnessOptions): InMemoryResetPasswordDatabase {
  let transactionQueue = Promise.resolve();
  const database: InMemoryResetPasswordDatabase = {
    users: [],
    passwordResetTokens: [],
    emailVerificationTokens: [],
    userSessions: [...(options.sessions ?? [])],
    refreshTokens: [...(options.refreshTokens ?? [])],
    auditLogs: [],
    lockKeys: [],
    preflightTokenLookups: [],
    transactionsStarted: 0,
    completedTransactions: 0,
    failPasswordUpdate: options.failPasswordUpdate ?? false,
    failCurrentTokenConsume: options.failCurrentTokenConsume ?? false,
    failOtherTokenRevoke: options.failOtherTokenRevoke ?? false,
    failSessionRevoke: options.failSessionRevoke ?? false,
    failRefreshTokenRevoke: options.failRefreshTokenRevoke ?? false,
    failAuditCreate: options.failAuditCreate ?? false,
    failTransaction: options.failTransaction ?? false,
    currentTokenConsumeCountZero: options.currentTokenConsumeCountZero ?? false,
    prisma: {
      passwordResetToken: {
        findUnique: async (args) => findPasswordResetTokenUnique(database, args, true)
      },
      $transaction: async <T>(callback: (transaction: InMemoryResetPasswordTransaction) => Promise<T>) => {
        const run = async () => {
          database.transactionsStarted += 1;

          if (database.failTransaction) {
            throw new Error('transaction failed');
          }

          const snapshot = cloneDatabase(database);

          try {
            const result = await callback(createInMemoryResetPasswordTransaction(database));
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

  if (options.seedUser !== false) {
    database.users.push(createUser(options.user));
    database.users.push(createUser({ id: 'user-2', email: 'other@example.invalid' }));
  }

  if (options.seedCurrentToken !== false) {
    database.passwordResetTokens.push(createResetToken(options.token));
  }

  database.passwordResetTokens.push(...(options.extraTokens ?? []));

  return database;
}

function createInMemoryResetPasswordTransaction(database: Omit<InMemoryResetPasswordDatabase, 'prisma'>) {
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
          if (database.failCurrentTokenConsume) {
            throw new Error('current token consume failed');
          }

          if (database.currentTokenConsumeCountZero) {
            return { count: 0 };
          }

          return updateCurrentPasswordResetToken(database, where, data);
        }

        if (database.failOtherTokenRevoke) {
          throw new Error('other token revoke failed');
        }

        return revokeOtherPasswordResetTokens(database, where, data);
      }
    },
    user: {
      update: async ({ where, data }: { where: { id: string }; data: { passwordHash: string } }) => {
        if (database.failPasswordUpdate) {
          throw new Error('password update failed');
        }

        const user = database.users.find((storedUser) => storedUser.id === where.id);

        if (!user) {
          throw new Error('user update failed');
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
        if (database.failSessionRevoke) {
          throw new Error('session revoke failed');
        }

        let count = 0;

        for (const session of database.userSessions) {
          if (where.id.in.includes(session.id) && session.revokedAt === where.revokedAt) {
            session.revokedAt = data.revokedAt;
            session.revokeReason = data.revokeReason;
            count += 1;
          }
        }

        return { count };
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
        if (database.failRefreshTokenRevoke) {
          throw new Error('refresh token revoke failed');
        }

        let count = 0;

        for (const token of database.refreshTokens) {
          if (where.sessionId.in.includes(token.sessionId) && token.revokedAt === where.revokedAt) {
            token.revokedAt = data.revokedAt;
            count += 1;
          }
        }

        return { count };
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

async function findPasswordResetTokenUnique(
  database: Omit<InMemoryResetPasswordDatabase, 'prisma'>,
  { where }: { where: { tokenHash: string } },
  isPreflight: boolean
) {
  if (isPreflight) {
    database.preflightTokenLookups.push(where.tokenHash);
  }

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
  database: Omit<InMemoryResetPasswordDatabase, 'prisma'>,
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
  database: Omit<InMemoryResetPasswordDatabase, 'prisma'>,
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
    email: overrides.email ?? 'user@example.invalid',
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
    expiresAt: overrides.expiresAt ?? new Date('2026-07-18T10:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    requestedIpHash: overrides.requestedIpHash ?? 'hash:ip:old',
    createdAt: overrides.createdAt ?? new Date('2026-07-17T09:00:00.000Z')
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

function cloneDatabase(database: Omit<InMemoryResetPasswordDatabase, 'prisma'>) {
  return {
    users: database.users.map((user) => ({ ...user })),
    passwordResetTokens: database.passwordResetTokens.map((token) => ({ ...token })),
    emailVerificationTokens: database.emailVerificationTokens.map((token) => ({ ...token })),
    userSessions: database.userSessions.map((session) => ({ ...session })),
    refreshTokens: database.refreshTokens.map((token) => ({ ...token })),
    auditLogs: database.auditLogs.map((log) => ({ ...log, metadata: { ...log.metadata } })),
    lockKeys: [...database.lockKeys],
    preflightTokenLookups: [...database.preflightTokenLookups],
    transactionsStarted: database.transactionsStarted,
    completedTransactions: database.completedTransactions,
    failPasswordUpdate: database.failPasswordUpdate,
    failCurrentTokenConsume: database.failCurrentTokenConsume,
    failOtherTokenRevoke: database.failOtherTokenRevoke,
    failSessionRevoke: database.failSessionRevoke,
    failRefreshTokenRevoke: database.failRefreshTokenRevoke,
    failAuditCreate: database.failAuditCreate,
    failTransaction: database.failTransaction,
    currentTokenConsumeCountZero: database.currentTokenConsumeCountZero
  };
}

function restoreDatabase(
  database: Omit<InMemoryResetPasswordDatabase, 'prisma'>,
  snapshot: ReturnType<typeof cloneDatabase>
): void {
  database.users = snapshot.users;
  database.passwordResetTokens = snapshot.passwordResetTokens;
  database.emailVerificationTokens = snapshot.emailVerificationTokens;
  database.userSessions = snapshot.userSessions;
  database.refreshTokens = snapshot.refreshTokens;
  database.auditLogs = snapshot.auditLogs;
  // Advisory locks are external transaction effects; keep the call record visible to tests.
  database.preflightTokenLookups = snapshot.preflightTokenLookups;
  database.transactionsStarted = snapshot.transactionsStarted;
  database.completedTransactions = snapshot.completedTransactions;
  database.failPasswordUpdate = snapshot.failPasswordUpdate;
  database.failCurrentTokenConsume = snapshot.failCurrentTokenConsume;
  database.failOtherTokenRevoke = snapshot.failOtherTokenRevoke;
  database.failSessionRevoke = snapshot.failSessionRevoke;
  database.failRefreshTokenRevoke = snapshot.failRefreshTokenRevoke;
  database.failAuditCreate = snapshot.failAuditCreate;
  database.failTransaction = snapshot.failTransaction;
  database.currentTokenConsumeCountZero = snapshot.currentTokenConsumeCountZero;
}

function sanitizeForComparison(database: ReturnType<typeof cloneDatabase>) {
  return {
    users: database.users,
    passwordResetTokens: database.passwordResetTokens,
    emailVerificationTokens: database.emailVerificationTokens,
    userSessions: database.userSessions,
    refreshTokens: database.refreshTokens,
    auditLogs: database.auditLogs
  };
}

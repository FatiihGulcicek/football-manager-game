import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@football-manager/database';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { EMAIL_VERIFIED_RESPONSE } from '../dto/verify-email.dto';
import {
  AUTH_EMAIL_VERIFICATION_INVALID_CODE,
  AUTH_EMAIL_VERIFICATION_INVALID_MESSAGE
} from '../errors/auth-email-verification-invalid.exception';
import { EmailVerificationRateLimitService } from './email-verification-rate-limit.service';
import { EmailVerificationService } from './email-verification.service';
import { TokenHashService } from './token-hash.service';

const TOKEN_INPUT = 'email-verify-input-fixture-012345678901';
const TOKEN_HASH = `hash:${TOKEN_INPUT}`;
const NOW = new Date('2026-07-17T10:00:00.000Z');

describe('EmailVerificationService', () => {
  it('should consume a valid token, verify the user, revoke other tokens, and audit success', async () => {
    const { transaction, tokenHashService, service } = createService();

    await expect(service.verifyEmail({ token: ` ${TOKEN_INPUT} ` }, { requestId: 'req-verify' }, NOW)).resolves.toEqual(
      EMAIL_VERIFIED_RESPONSE
    );

    expect(tokenHashService.hashToken).toHaveBeenCalledWith(TOKEN_INPUT);
    expect(transaction.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: {
        tokenHash: TOKEN_HASH
      },
      select: expect.any(Object)
    });
    expect(transaction.emailVerificationToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'verification-token-1',
        usedAt: null,
        revokedAt: null,
        expiresAt: {
          gt: NOW
        }
      },
      data: {
        usedAt: NOW
      }
    });
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: {
        id: 'user-1'
      },
      data: {
        emailVerifiedAt: NOW
      }
    });
    expect(transaction.emailVerificationToken.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        userId: 'user-1',
        id: {
          not: 'verification-token-1'
        },
        usedAt: null,
        revokedAt: null
      },
      data: {
        revokedAt: NOW
      }
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.EMAIL_VERIFIED,
        entityType: 'User',
        entityId: 'user-1',
        metadata: {
          context: 'WEB',
          verificationMethod: 'TOKEN'
        }
      }
    });
    expect(JSON.stringify(transaction.auditLog.create.mock.calls)).not.toContain(TOKEN_INPUT);
    expect(JSON.stringify(transaction.auditLog.create.mock.calls)).not.toContain(TOKEN_HASH);
  });

  it('should consume a valid unused token even when the user is already verified', async () => {
    const { transaction, service } = createService();
    transaction.emailVerificationToken.findUnique.mockResolvedValue(
      createStoredVerificationToken({
        user: {
          id: 'user-1',
          isActive: true,
          emailVerifiedAt: new Date('2026-07-16T10:00:00.000Z')
        }
      })
    );

    await expect(service.verifyEmail({ token: TOKEN_INPUT }, { requestId: 'req-verified' }, NOW)).resolves.toEqual(
      EMAIL_VERIFIED_RESPONSE
    );
    expect(transaction.emailVerificationToken.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: {
          usedAt: NOW
        }
      })
    );
  });

  it('should return the same generic error for missing, expired, revoked, used, and disabled-user tokens', async () => {
    const cases = [
      null,
      createStoredVerificationToken({ expiresAt: new Date('2026-07-17T09:59:59.000Z') }),
      createStoredVerificationToken({ revokedAt: new Date('2026-07-17T09:00:00.000Z') }),
      createStoredVerificationToken({ usedAt: new Date('2026-07-17T09:00:00.000Z') }),
      createStoredVerificationToken({
        user: {
          id: 'user-1',
          isActive: false,
          emailVerifiedAt: null
        }
      })
    ];

    for (const verificationToken of cases) {
      const { transaction, service } = createService();
      transaction.emailVerificationToken.findUnique.mockResolvedValue(verificationToken);

      await expectInvalidVerification(service.verifyEmail({ token: TOKEN_INPUT }, { requestId: 'req-invalid' }, NOW));
      expect(transaction.auditLog.create).not.toHaveBeenCalled();
    }
  });

  it('should return the generic error for invalid request bodies and unsupported fields', async () => {
    const { transaction, service } = createService();

    await expectInvalidVerification(service.verifyEmail({ token: 'short' }, { requestId: 'req-short' }, NOW), 'req-short');
    await expectInvalidVerification(
      service.verifyEmail({ token: `${TOKEN_INPUT}\0` }, { requestId: 'req-control' }, NOW),
      'req-control'
    );
    await expectInvalidVerification(
      service.verifyEmail({ token: TOKEN_INPUT, role: UserRole.ADMIN } as never, { requestId: 'req-extra' }, NOW),
      'req-extra'
    );
    await expectInvalidVerification(
      service.verifyEmail({ token: undefined }, { requestId: 'req-missing' }, NOW),
      'req-missing'
    );

    expect(transaction.emailVerificationToken.findUnique).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('should convert concurrent consume loss into a generic invalid response', async () => {
    const { transaction, service } = createService();
    transaction.emailVerificationToken.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 0 });

    await expectInvalidVerification(service.verifyEmail({ token: TOKEN_INPUT }, { requestId: 'req-race' }, NOW), 'req-race');
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('should roll back later writes when verification fails inside the transaction', async () => {
    const { transaction, service } = createService();
    transaction.user.update.mockRejectedValue(new Error('user update failed'));

    await expect(service.verifyEmail({ token: TOKEN_INPUT }, { requestId: 'req-rollback' }, NOW)).rejects.toThrow(
      'user update failed'
    );
    expect(transaction.emailVerificationToken.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('should not create sessions, access tokens, or refresh tokens', async () => {
    const { transaction, service } = createService();

    await service.verifyEmail({ token: TOKEN_INPUT }, { requestId: 'req-no-session' }, NOW);

    expect('userSession' in transaction).toBe(false);
    expect('refreshToken' in transaction).toBe(false);
  });
});

function createService() {
  const transaction = {
    emailVerificationToken: {
      findUnique: vi.fn(async (): Promise<ReturnType<typeof createStoredVerificationToken> | null> =>
        createStoredVerificationToken()
      ),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    user: {
      update: vi.fn(async () => undefined)
    },
    auditLog: {
      create: vi.fn(async () => undefined)
    }
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<void>) =>
      callback(transaction)
    )
  };
  const tokenHashService = {
    hashToken: vi.fn((token: string) => `hash:${token}`)
  };
  const rateLimitService = {
    consumeVerifyEmailAttempt: vi.fn(async () => undefined)
  };
  const service = new EmailVerificationService(
    prisma as unknown as PrismaService,
    tokenHashService as unknown as TokenHashService,
    rateLimitService as unknown as EmailVerificationRateLimitService
  );

  return {
    prisma,
    transaction,
    tokenHashService,
    rateLimitService,
    service
  };
}

function createStoredVerificationToken(
  overrides: Partial<{
    id: string;
    userId: string;
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    user: {
      id: string;
      isActive: boolean;
      emailVerifiedAt: Date | null;
    };
  }> = {}
) {
  return {
    id: overrides.id ?? 'verification-token-1',
    userId: overrides.userId ?? 'user-1',
    expiresAt: overrides.expiresAt ?? new Date('2026-07-18T10:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    user: overrides.user ?? {
      id: 'user-1',
      isActive: true,
      emailVerifiedAt: null
    }
  };
}

async function expectInvalidVerification(promise: Promise<unknown>, requestId = 'req-invalid'): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      error: {
        code: AUTH_EMAIL_VERIFICATION_INVALID_CODE,
        message: AUTH_EMAIL_VERIFICATION_INVALID_MESSAGE,
        requestId
      }
    });
    return;
  }

  throw new Error('Expected verify-email to reject with a generic invalid response');
}

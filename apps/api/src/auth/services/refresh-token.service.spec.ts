import { describe, expect, it, vi } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import {
  RefreshTokenConflictError,
  RefreshTokenReusedError,
  RefreshTokenService
} from './refresh-token.service';
import { SessionService } from './session.service';
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

describe('RefreshTokenService', () => {
  it('should issue the initial refresh token with only its hash stored', async () => {
    const { prisma, service } = createService();

    const issued = await service.issueInitialToken('session-1', new Date('2026-01-01T00:00:00.000Z'));

    expect(issued.token).toBeTruthy();
    expect(issued.tokenHash).not.toContain(issued.token);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        tokenHash: issued.tokenHash,
        expiresAt: new Date('2026-01-01T00:00:00.000Z')
      }
    });
  });

  it('should rotate a refresh token in a transaction', async () => {
    const { prisma, service, tokenHashService } = createService();
    const rawToken = 'refresh-token';
    const tokenHash = tokenHashService.hashToken(rawToken);
    prisma.refreshToken.findUnique.mockResolvedValue(
      createRefreshTokenRecord({ tokenHash, expiresAt: new Date('2026-01-01T00:00:00.000Z') })
    );
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const rotated = await service.rotateToken(rawToken, new Date('2025-01-01T00:00:00.000Z'));

    expect(rotated.token).not.toBe(rawToken);
    expect(rotated.tokenHash).not.toBe(tokenHash);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: 'session-1',
        parentTokenId: 'token-1',
        tokenHash: rotated.tokenHash
      })
    });
  });

  it('should reject duplicate rotation inside the grace window without revoking the session', async () => {
    const { prisma, service, sessionService, tokenHashService } = createService();
    const rawToken = 'refresh-token';
    prisma.refreshToken.findUnique.mockResolvedValue(
      createRefreshTokenRecord({
        tokenHash: tokenHashService.hashToken(rawToken),
        usedAt: new Date('2025-01-01T00:00:03.000Z')
      })
    );

    await expect(service.rotateToken(rawToken, new Date('2025-01-01T00:00:05.000Z'))).rejects.toBeInstanceOf(
      RefreshTokenConflictError
    );
    expect(sessionService.revokeSession).not.toHaveBeenCalled();
  });

  it('should revoke the token family after replay outside the grace window', async () => {
    const { prisma, service, sessionService, tokenHashService } = createService();
    const rawToken = 'refresh-token';
    prisma.refreshToken.findUnique.mockResolvedValue(
      createRefreshTokenRecord({
        tokenHash: tokenHashService.hashToken(rawToken),
        usedAt: new Date('2025-01-01T00:00:00.000Z')
      })
    );

    await expect(service.rotateToken(rawToken, new Date('2025-01-01T00:00:10.000Z'))).rejects.toBeInstanceOf(
      RefreshTokenReusedError
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: 'session-1',
          revokedAt: null
        }
      })
    );
    expect(sessionService.revokeSession).toHaveBeenCalledWith(
      'session-1',
      'refresh_reused',
      new Date('2025-01-01T00:00:10.000Z')
    );
  });

  it('should leave the token untouched when the transaction rolls back', async () => {
    const { prisma, service, tokenHashService } = createService();
    const rawToken = 'refresh-token';
    prisma.refreshToken.findUnique.mockResolvedValue(
      createRefreshTokenRecord({ tokenHash: tokenHashService.hashToken(rawToken) })
    );
    prisma.$transaction.mockRejectedValue(new Error('db failed'));

    await expect(service.rotateToken(rawToken, new Date('2025-01-01T00:00:00.000Z'))).rejects.toThrow(
      'db failed'
    );
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('should prevent a second child when the parent was already consumed concurrently', async () => {
    const { prisma, service, tokenHashService } = createService();
    const rawToken = 'refresh-token';
    prisma.refreshToken.findUnique.mockResolvedValue(
      createRefreshTokenRecord({ tokenHash: tokenHashService.hashToken(rawToken) })
    );
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.rotateToken(rawToken, new Date('2025-01-01T00:00:00.000Z'))
    ).rejects.toBeInstanceOf(RefreshTokenConflictError);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

function createService() {
  const refreshToken = {
    create: vi.fn(async () => undefined),
    findUnique: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 }))
  };
  const prisma = {
    refreshToken: {
      create: refreshToken.create,
      findUnique: refreshToken.findUnique,
      updateMany: refreshToken.updateMany
    },
    $transaction: vi.fn(async (callback: (transaction: { refreshToken: typeof refreshToken }) => Promise<void>) =>
      callback({ refreshToken })
    )
  };
  const tokenHashService = new TokenHashService(config);
  const sessionService = {
    revokeSession: vi.fn(async () => undefined)
  } as unknown as SessionService;
  const service = new RefreshTokenService(
    prisma as unknown as PrismaService,
    tokenHashService,
    sessionService,
    config
  );

  return {
    prisma,
    service,
    sessionService,
    tokenHashService
  };
}

function createRefreshTokenRecord(overrides: {
  tokenHash: string;
  expiresAt?: Date;
  usedAt?: Date | null;
  revokedAt?: Date | null;
}) {
  return {
    id: 'token-1',
    sessionId: 'session-1',
    tokenHash: overrides.tokenHash,
    parentTokenId: null,
    expiresAt: overrides.expiresAt ?? new Date('2026-01-01T00:00:00.000Z'),
    usedAt: overrides.usedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt: new Date('2025-01-01T00:00:00.000Z')
  };
}

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { AccessTokenService } from './access-token.service';
import { RefreshRateLimitService } from './refresh-rate-limit.service';
import { RefreshService } from './refresh.service';
import { RefreshTokenService } from './refresh-token.service';
import { SessionInactiveError, SessionService } from './session.service';
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

const now = new Date('2026-01-01T00:00:00.000Z');
const requestContext = {
  requestId: 'req-refresh',
  clientIp: '127.0.0.1'
};

describe('RefreshService', () => {
  it('should reject a missing refresh cookie with the safe refresh envelope', async () => {
    const { prisma, service } = createService();

    await expect(service.refresh(undefined, requestContext, now)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: null,
        action: AUTH_AUDIT_EVENTS.REFRESH_FAILED,
        metadata: {
          context: 'REFRESH',
          reason: 'missing_cookie'
        }
      })
    });
  });

  it('should rotate a valid refresh token and issue a new access token', async () => {
    const { accessTokenService, prisma, service, tokenHashService, transaction } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(createStoredRefreshToken());

    const result = await service.refresh('old-refresh-token', requestContext, now);

    expect(result).toEqual({
      response: {
        accessToken: 'access-token',
        tokenType: 'Bearer',
        expiresIn: 900
      },
      refreshCookie: {
        value: 'new-refresh-token',
        expiresAt: new Date('2026-02-01T00:00:00.000Z')
      }
    });
    expect(tokenHashService.hashToken).toHaveBeenCalledWith('old-refresh-token');
    expect(accessTokenService.signAccessToken).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1'
    });
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'token-1',
        usedAt: null,
        revokedAt: null,
        expiresAt: {
          gt: now
        }
      },
      data: {
        usedAt: now
      }
    });
    expect(transaction.refreshToken.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        parentTokenId: 'token-1',
        tokenHash: 'hash:new-refresh-token',
        expiresAt: new Date('2026-02-01T00:00:00.000Z')
      }
    });
    expect(transaction.userSession.update).toHaveBeenCalledWith({
      where: {
        id: 'session-1'
      },
      data: {
        lastSeenAt: now
      }
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AUTH_AUDIT_EVENTS.REFRESH_SUCCEEDED,
        entityType: 'UserSession',
        entityId: 'session-1',
        metadata: {
          context: 'REFRESH',
          reason: 'success',
          sessionId: 'session-1'
        },
        ipHash: 'hash:ip:127.0.0.1'
      })
    });
    expect(JSON.stringify(result.response)).not.toContain('new-refresh-token');
    expect(JSON.stringify(transaction.refreshToken.create.mock.calls)).not.toContain('old-refresh-token');
  });

  it('should reject inactive sessions without creating new tokens', async () => {
    const { prisma, service, sessionService, transaction } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(createStoredRefreshToken());
    sessionService.assertSessionActive.mockRejectedValue(new SessionInactiveError());

    await expect(service.refresh('old-refresh-token', requestContext, now)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });

  it('should reject disabled users without creating a new token', async () => {
    const { prisma, service, transaction } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(
      createStoredRefreshToken({
        session: {
          ...createStoredRefreshToken().session,
          user: {
            id: 'user-1',
            role: 'USER',
            isActive: false
          }
        }
      })
    );

    await expect(service.refresh('old-refresh-token', requestContext, now)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });

  it('should return conflict inside the grace window without revoking the session', async () => {
    const { prisma, refreshTokenService, service, transaction } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(
      createStoredRefreshToken({
        usedAt: new Date('2025-12-31T23:59:58.000Z')
      })
    );

    await expect(service.refresh('old-refresh-token', requestContext, now)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(refreshTokenService.revokeTokenFamily).not.toHaveBeenCalled();
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });

  it('should revoke the token family and audit replay outside the grace window', async () => {
    const { prisma, refreshTokenService, service } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(
      createStoredRefreshToken({
        usedAt: new Date('2025-12-31T23:59:50.000Z')
      })
    );

    await expect(service.refresh('old-refresh-token', requestContext, now)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(refreshTokenService.revokeTokenFamily).toHaveBeenCalledWith('session-1', now);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AUTH_AUDIT_EVENTS.REFRESH_REUSED,
        entityType: 'UserSession',
        entityId: 'session-1',
        metadata: {
          context: 'REFRESH',
          reason: 'reused',
          sessionId: 'session-1'
        }
      })
    });
  });

  it('should not write LoginAttempt records during refresh', async () => {
    const { prisma, service } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(createStoredRefreshToken());

    await service.refresh('old-refresh-token', requestContext, now);

    expect(prisma.loginAttempt?.create).not.toHaveBeenCalled();
  });
});

function createService() {
  const transaction = {
    refreshToken: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => undefined)
    },
    userSession: {
      findFirst: vi.fn(async () => ({
        id: 'session-1',
        userId: 'user-1',
        user: {
          role: 'USER'
        }
      })),
      update: vi.fn(async () => undefined)
    },
    auditLog: {
      create: vi.fn(async () => undefined)
    }
  };
  const prisma = {
    refreshToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(async () => undefined)
    },
    auditLog: {
      create: vi.fn(async () => undefined)
    },
    loginAttempt: {
      create: vi.fn(async () => undefined)
    },
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<void>) =>
      callback(transaction)
    )
  };
  const tokenHashService = {
    generateOpaqueToken: vi.fn(() => 'new-refresh-token'),
    hashToken: vi.fn((value: string) => `hash:${value}`)
  };
  const sessionService = {
    assertSessionActive: vi.fn(async () => undefined)
  };
  const refreshTokenService = {
    revokeTokenFamily: vi.fn(async () => undefined)
  };
  const accessTokenService = {
    signAccessToken: vi.fn(() => 'access-token')
  };
  const rateLimitService = {
    consumeRefreshAttempt: vi.fn(async () => undefined)
  };
  const service = new RefreshService(
    prisma as unknown as PrismaService,
    tokenHashService as unknown as TokenHashService,
    sessionService as unknown as SessionService,
    refreshTokenService as unknown as RefreshTokenService,
    accessTokenService as unknown as AccessTokenService,
    rateLimitService as unknown as RefreshRateLimitService,
    config
  );

  return {
    accessTokenService,
    prisma,
    refreshTokenService,
    service,
    sessionService,
    tokenHashService,
    transaction
  };
}

function createStoredRefreshToken(overrides: Partial<StoredRefreshTokenFixture> = {}): StoredRefreshTokenFixture {
  return {
    id: 'token-1',
    sessionId: 'session-1',
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    usedAt: null,
    revokedAt: null,
    session: {
      id: 'session-1',
      userId: 'user-1',
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      revokedAt: null,
      user: {
        id: 'user-1',
        role: 'USER',
        isActive: true
      }
    },
    ...overrides
  };
}

type StoredRefreshTokenFixture = {
  id: string;
  sessionId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    user: {
      id: string;
      role: string;
      isActive: boolean;
    };
  };
};

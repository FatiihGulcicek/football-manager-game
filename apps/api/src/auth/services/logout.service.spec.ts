import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { LogoutRequestContext, LogoutService } from './logout.service';
import { SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

const now = new Date('2026-01-01T00:00:00.000Z');
const requestContext: LogoutRequestContext = {
  requestId: 'req-logout',
  clientIp: '127.0.0.1'
};

describe('LogoutService', () => {
  it('should return safely without database lookup when the refresh cookie is missing', async () => {
    const { prisma, service, sessionService, tokenHashService } = createService();

    await service.logout(undefined, requestContext, now);

    expect(tokenHashService.hashToken).not.toHaveBeenCalled();
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    expect(sessionService.revokeSession).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.loginAttempt?.create).not.toHaveBeenCalled();
  });

  it('should revoke the matched current session and write a safe audit event', async () => {
    const { prisma, service, sessionService, tokenHashService } = createService();

    await service.logout('current-refresh-token', requestContext, now);

    expect(tokenHashService.hashToken).toHaveBeenCalledWith('current-refresh-token');
    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
      where: {
        tokenHash: 'hash:current-refresh-token'
      },
      select: {
        sessionId: true,
        session: {
          select: {
            id: true,
            userId: true,
            revokedAt: true
          }
        }
      }
    });
    expect(sessionService.revokeSession).toHaveBeenCalledWith('session-1', 'user_logout', now);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.LOGOUT,
        entityType: 'UserSession',
        entityId: 'session-1',
        metadata: {
          context: 'LOGOUT',
          reason: 'user_logout',
          sessionId: 'session-1'
        },
        ipHash: 'hash-ip'
      }
    });
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain('current-refresh-token');
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain('127.0.0.1');
  });

  it('should return 204-equivalent success for forged or unknown refresh cookies', async () => {
    const { prisma, service, sessionService } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.logout('forged-refresh-token', requestContext, now)).resolves.toBeUndefined();

    expect(sessionService.revokeSession).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('should be idempotent when the matched session is already revoked', async () => {
    const { prisma, service, sessionService } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(
      createStoredRefreshToken({
        session: {
          id: 'session-1',
          userId: 'user-1',
          revokedAt: new Date('2025-12-31T00:00:00.000Z')
        }
      })
    );

    await service.logout('current-refresh-token', requestContext, now);

    expect(sessionService.revokeSession).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('should keep the logout result successful when audit storage fails after revoke', async () => {
    const { prisma, service, sessionService } = createService();
    prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.logout('current-refresh-token', requestContext, now)).resolves.toBeUndefined();

    expect(sessionService.revokeSession).toHaveBeenCalledWith('session-1', 'user_logout', now);
    expect(prisma.loginAttempt?.create).not.toHaveBeenCalled();
  });

  it('should propagate revoke failures so a partial logout cannot be reported as successful', async () => {
    const { prisma, service, sessionService } = createService();
    sessionService.revokeSession.mockRejectedValue(new Error('refresh token revoke failed'));

    await expect(service.logout('current-refresh-token', requestContext, now)).rejects.toThrow(
      'refresh token revoke failed'
    );

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

function createService() {
  const prisma = {
    refreshToken: {
      findUnique: vi.fn(async (): Promise<StoredRefreshTokenFixture | null> => createStoredRefreshToken())
    },
    auditLog: {
      create: vi.fn(async () => undefined)
    },
    loginAttempt: {
      create: vi.fn(async () => undefined)
    }
  };
  const tokenHashService = {
    hashToken: vi.fn((value: string) => {
      if (value.startsWith('ip:')) {
        return 'hash-ip';
      }

      return `hash:${value}`;
    })
  };
  const sessionService = {
    revokeSession: vi.fn(async () => undefined)
  };
  const service = new LogoutService(
    prisma as unknown as PrismaService,
    tokenHashService as unknown as TokenHashService,
    sessionService as unknown as SessionService
  );

  return {
    prisma,
    service,
    sessionService,
    tokenHashService
  };
}

function createStoredRefreshToken(overrides: Partial<StoredRefreshTokenFixture> = {}): StoredRefreshTokenFixture {
  return {
    sessionId: 'session-1',
    session: {
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null
    },
    ...overrides
  };
}

type StoredRefreshTokenFixture = {
  sessionId: string;
  session: {
    id: string;
    userId: string;
    revokedAt: Date | null;
  } | null;
};

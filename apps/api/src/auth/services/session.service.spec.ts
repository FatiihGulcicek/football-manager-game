import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service';
import { SessionCache, SessionInactiveError, SessionService } from './session.service';

describe('SessionService', () => {
  it('should resolve an active session from the database', async () => {
    const { prisma } = createPrismaMock();
    prisma.userSession.findFirst.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      user: {
        role: 'USER'
      }
    });
    const service = new SessionService(prisma as unknown as PrismaService);

    await expect(service.getActiveSession('session-1')).resolves.toMatchObject({
      id: 'session-1',
      userId: 'user-1',
      userRole: 'USER'
    });
  });

  it('should reject an expired session', async () => {
    const { prisma } = createPrismaMock();
    prisma.userSession.findFirst.mockResolvedValue(null);
    const service = new SessionService(prisma as unknown as PrismaService);

    await expect(service.assertSessionActive('expired-session')).rejects.toBeInstanceOf(
      SessionInactiveError
    );
  });

  it('should reject a revoked session', async () => {
    const { prisma } = createPrismaMock();
    prisma.userSession.findFirst.mockResolvedValue(null);
    const service = new SessionService(prisma as unknown as PrismaService);

    await expect(service.assertSessionActive('revoked-session')).rejects.toThrow('SESSION_INACTIVE');
  });

  it('should reject a disabled user session', async () => {
    const { prisma } = createPrismaMock();
    prisma.userSession.findFirst.mockResolvedValue(null);
    const service = new SessionService(prisma as unknown as PrismaService);

    await expect(service.assertSessionActive('disabled-user-session')).rejects.toThrow(
      'SESSION_INACTIVE'
    );
  });

  it('should trust a positive cache hit without querying the database', async () => {
    const { prisma } = createPrismaMock();
    const cache: SessionCache = {
      get: vi.fn(async () => true),
      set: vi.fn(),
      delete: vi.fn()
    };
    const service = new SessionService(prisma as unknown as PrismaService, cache);

    await expect(service.assertSessionActive('session-1')).resolves.toBeUndefined();
    expect(prisma.userSession.findFirst).not.toHaveBeenCalled();
  });

  it('should revoke one session and invalidate cache', async () => {
    const { prisma } = createPrismaMock();
    const cache: SessionCache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn()
    };
    const service = new SessionService(prisma as unknown as PrismaService, cache);

    await service.revokeSession('session-1', 'logout');

    expect(prisma.userSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'session-1',
          revokedAt: null
        }
      })
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: 'session-1',
          revokedAt: null
        }
      })
    );
    expect(cache.delete).toHaveBeenCalledWith('session-1');
  });

  it('should not invalidate cache when session revoke transaction fails', async () => {
    const { prisma } = createPrismaMock();
    prisma.$transaction.mockRejectedValue(new Error('refresh token revoke failed'));
    const cache: SessionCache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn()
    };
    const service = new SessionService(prisma as unknown as PrismaService, cache);

    await expect(service.revokeSession('session-1', 'user_logout')).rejects.toThrow(
      'refresh token revoke failed'
    );

    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('should revoke all user sessions and invalidate each cache key', async () => {
    const { prisma } = createPrismaMock();
    prisma.userSession.findMany.mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }]);
    const cache: SessionCache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn()
    };
    const service = new SessionService(prisma as unknown as PrismaService, cache);

    await service.revokeAllUserSessions('user-1', 'logout_all');

    expect(prisma.userSession.updateMany).toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(cache.delete).toHaveBeenCalledWith('session-1');
    expect(cache.delete).toHaveBeenCalledWith('session-2');
  });
});

function createPrismaMock() {
  const prisma = {
    userSession: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    refreshToken: {
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations))
  };

  return { prisma };
}

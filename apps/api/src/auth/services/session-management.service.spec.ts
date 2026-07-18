import { UserRole } from '@football-manager/database';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { AuthenticatedUser } from '../types/authenticated-user';
import { SessionManagementService } from './session-management.service';
import { SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

describe('SessionManagementService', () => {
  it('should list only safe session response fields with the current session first', async () => {
    const { service } = createService({
      listUserSessions: vi.fn(async () => [
        createStoredSession({
          id: 'session-other',
          lastSeenAt: new Date('2026-01-03T00:00:00.000Z')
        }),
        createStoredSession({
          id: 'session-current',
          lastSeenAt: new Date('2026-01-01T00:00:00.000Z')
        })
      ])
    });

    const response = await service.listSessions(createUser());

    expect(response.sessions.map((session) => session.id)).toEqual(['session-current', 'session-other']);
    expect(response.sessions[0]).toEqual({
      id: 'session-current',
      deviceName: 'Windows Chrome',
      deviceType: 'DESKTOP',
      browser: 'Chrome',
      operatingSystem: 'Windows',
      countryCode: 'TR',
      city: 'Samsun',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-02-01T00:00:00.000Z',
      isCurrent: true
    });
    expect(JSON.stringify(response)).not.toContain('tokenFamilyId');
    expect(JSON.stringify(response)).not.toContain('ipHash');
    expect(JSON.stringify(response)).not.toContain('userAgentHash');
    expect(JSON.stringify(response)).not.toContain('refreshToken');
    expect(JSON.stringify(response)).not.toContain('user-1');
  });

  it('should revoke all user sessions and write allowlisted audit metadata', async () => {
    const { service, sessionService, prisma } = createService({
      revokeAllUserSessions: vi.fn(async () => 2)
    });

    await service.logoutAll(createUser(), {
      requestId: 'req-logout-all',
      clientIp: '203.0.113.10'
    });

    expect(sessionService.revokeAllUserSessions).toHaveBeenCalledWith('user-1', 'user_logout_all');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.LOGOUT_ALL,
        metadata: {
          sessionCount: 2,
          reason: 'user_logout_all'
        },
        ipHash: 'hash:ip:203.0.113.10'
      })
    });
  });

  it('should not fail logout-all when audit storage fails', async () => {
    const { service, prisma } = createService({
      revokeAllUserSessions: vi.fn(async () => 1)
    });
    prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      service.logoutAll(createUser(), {
        requestId: 'req-logout-all',
        clientIp: '203.0.113.10'
      })
    ).resolves.toBeUndefined();
  });

  it('should revoke an owned target session and record whether it is current', async () => {
    const { service, sessionService, prisma } = createService({
      revokeOwnedSession: vi.fn(async () => ({
        sessionId: 'session-other',
        wasActive: true
      }))
    });

    await expect(
      service.revokeSession(createUser(), 'session-other', {
        requestId: 'req-revoke',
        clientIp: '203.0.113.10'
      })
    ).resolves.toEqual({ isCurrent: false });

    expect(sessionService.revokeOwnedSession).toHaveBeenCalledWith(
      'user-1',
      'session-other',
      'user_session_revoke'
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.SESSION_REVOKED,
        entityType: 'UserSession',
        entityId: 'session-other',
        metadata: {
          targetSessionId: 'session-other',
          isCurrent: false,
          reason: 'user_session_revoke'
        }
      })
    });
  });

  it('should allow current session revoke so the controller can clear the cookie', async () => {
    const { service } = createService({
      revokeOwnedSession: vi.fn(async () => ({
        sessionId: 'session-current',
        wasActive: true
      }))
    });

    await expect(
      service.revokeSession(createUser(), 'session-current', {
        requestId: 'req-current',
        clientIp: '203.0.113.10'
      })
    ).resolves.toEqual({ isCurrent: true });
  });

  it('should return a 404 envelope for another user or missing session', async () => {
    const { service } = createService({
      revokeOwnedSession: vi.fn(async () => null)
    });

    await expect(
      service.revokeSession(createUser(), 'session-b', {
        requestId: 'req-not-found',
        clientIp: '203.0.113.10'
      })
    ).rejects.toMatchObject({
      response: {
        error: {
          code: 'AUTH_SESSION_NOT_FOUND',
          message: 'Oturum bulunamadı.',
          requestId: 'req-not-found'
        }
      }
    });
  });

  it('should not fail session revoke when audit storage fails', async () => {
    const { service, prisma } = createService({
      revokeOwnedSession: vi.fn(async () => ({
        sessionId: 'session-other',
        wasActive: true
      }))
    });
    prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      service.revokeSession(createUser(), 'session-other', {
        requestId: 'req-revoke',
        clientIp: '203.0.113.10'
      })
    ).resolves.toEqual({ isCurrent: false });
  });
});

function createService(
  overrides: Partial<
    Pick<SessionService, 'listUserSessions' | 'revokeAllUserSessions' | 'revokeOwnedSession'>
  > = {}
) {
  const prisma = {
    auditLog: {
      create: vi.fn(async () => undefined)
    }
  };
  const sessionService = {
    listUserSessions: vi.fn(async () => []),
    revokeAllUserSessions: vi.fn(async () => 0),
    revokeOwnedSession: vi.fn(async () => null),
    ...overrides
  };
  const tokenHashService = {
    hashToken: vi.fn((value: string) => `hash:${value}`)
  };

  return {
    prisma,
    sessionService,
    service: new SessionManagementService(
      prisma as unknown as PrismaService,
      sessionService as unknown as SessionService,
      tokenHashService as unknown as TokenHashService
    )
  };
}

function createUser(): AuthenticatedUser {
  return {
    userId: 'user-1',
    role: UserRole.USER,
    sessionId: 'session-current'
  };
}

function createStoredSession(overrides: { id: string; lastSeenAt: Date }) {
  return {
    id: overrides.id,
    deviceName: 'Windows Chrome',
    deviceType: 'desktop',
    browser: 'Chrome',
    operatingSystem: 'Windows',
    countryCode: 'TR',
    city: 'Samsun',
    lastSeenAt: overrides.lastSeenAt,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-02-01T00:00:00.000Z')
  };
}

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@football-manager/database';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenService } from '../services/access-token.service';
import { SessionInactiveError, SessionService } from '../services/session.service';
import { AuthenticatedHttpRequest } from '../types/authenticated-user';
import { AccessTokenGuard } from './access-token.guard';

describe('AccessTokenGuard', () => {
  it('should reject a missing authorization header with the auth envelope', async () => {
    const { guard } = createGuard();

    await expect(guard.canActivate(createContext({ headers: { 'x-request-id': 'req-missing' } }))).rejects.toMatchObject({
      response: {
        error: {
          code: 'AUTH_UNAUTHORIZED',
          message: 'Oturum geçersiz veya süresi dolmuş.',
          requestId: 'req-missing'
        }
      }
    });
  });

  it('should reject malformed bearer headers without leaking token details', async () => {
    const { guard } = createGuard();

    try {
      await guard.canActivate(
        createContext({
          headers: {
            authorization: 'Basic raw.jwt.fixture',
            'x-request-id': 'req-malformed'
          }
        })
      );
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(JSON.stringify((error as UnauthorizedException).getResponse())).not.toContain('raw.jwt.fixture');
      return;
    }

    throw new Error('guard should reject malformed authorization headers');
  });

  it('should reject invalid, expired, or unknown-kid tokens with the same envelope', async () => {
    const { guard, accessTokenService } = createGuard();
    accessTokenService.verifyAccessToken.mockImplementation(() => {
      throw new Error('TOKEN_UNKNOWN_KID');
    });

    await expect(
      guard.canActivate(
        createContext({
          headers: {
            authorization: 'Bearer access-token-fixture',
            'x-request-id': 'req-invalid-token'
          }
        })
      )
    ).rejects.toMatchObject({
      response: {
        error: {
          code: 'AUTH_UNAUTHORIZED',
          requestId: 'req-invalid-token'
        }
      }
    });
  });

  it('should reject revoked, expired, or disabled-user sessions', async () => {
    const { guard, sessionService } = createGuard();
    sessionService.assertSessionActive.mockRejectedValue(new SessionInactiveError());

    await expect(
      guard.canActivate(
        createContext({
          headers: {
            authorization: 'Bearer access-token-fixture',
            'x-request-id': 'req-session-revoked'
          }
        })
      )
    ).rejects.toMatchObject({
      response: {
        error: {
          code: 'AUTH_UNAUTHORIZED',
          requestId: 'req-session-revoked'
        }
      }
    });
  });

  it('should reject when the JWT subject does not match the active session user', async () => {
    const { guard, sessionService } = createGuard();
    sessionService.getActiveSession.mockResolvedValue({
      id: 'session-1',
      userId: 'other-user',
      userRole: UserRole.USER,
      expiresAt: new Date('2027-01-01T00:00:00.000Z')
    });

    await expect(
      guard.canActivate(
        createContext({
          headers: {
            authorization: 'Bearer access-token-fixture',
            'x-request-id': 'req-sub-mismatch'
          }
        })
      )
    ).rejects.toMatchObject({
      response: {
        error: {
          code: 'AUTH_UNAUTHORIZED',
          requestId: 'req-sub-mismatch'
        }
      }
    });
  });

  it('should reject when the JWT role no longer matches the active user role', async () => {
    const { guard, sessionService } = createGuard();
    sessionService.getActiveSession.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      userRole: UserRole.ADMIN,
      expiresAt: new Date('2027-01-01T00:00:00.000Z')
    });

    await expect(
      guard.canActivate(
        createContext({
          headers: {
            authorization: 'Bearer access-token-fixture',
            'x-request-id': 'req-role-mismatch'
          }
        })
      )
    ).rejects.toMatchObject({
      response: {
        error: {
          code: 'AUTH_UNAUTHORIZED',
          requestId: 'req-role-mismatch'
        }
      }
    });
  });

  it('should attach the authenticated user context for a valid token and active session', async () => {
    const { guard, request } = createGuardWithRequest();

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(request.authenticatedUser).toEqual({
      userId: 'user-1',
      role: UserRole.USER,
      sessionId: 'session-1'
    });
  });
});

function createGuard() {
  const accessTokenService = {
    verifyAccessToken: vi.fn(() => ({
      userId: 'user-1',
      role: UserRole.USER,
      sessionId: 'session-1',
      issuedAtSeconds: 1,
      expiresAtSeconds: 2,
      keyId: 'test'
    }))
  };
  const sessionService = {
    assertSessionActive: vi.fn(async () => undefined),
    getActiveSession: vi.fn(async () => ({
      id: 'session-1',
      userId: 'user-1',
      userRole: UserRole.USER as string,
      expiresAt: new Date('2027-01-01T00:00:00.000Z')
    }))
  };

  return {
    accessTokenService,
    sessionService,
    guard: new AccessTokenGuard(
      accessTokenService as unknown as AccessTokenService,
      sessionService as unknown as SessionService
    )
  };
}

function createGuardWithRequest() {
  const created = createGuard();
  const request: AuthenticatedHttpRequest = {
    headers: {
      authorization: 'Bearer access-token-fixture',
      'x-request-id': 'req-valid'
    }
  };

  return {
    ...created,
    request
  };
}

function createContext(request: AuthenticatedHttpRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as unknown as ExecutionContext;
}

import { UnauthorizedException } from '@nestjs/common';
import { LoginContext } from '@football-manager/database';
import { describe, expect, it, vi } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { AccessTokenService } from './access-token.service';
import { LoginRateLimitService } from './login-rate-limit.service';
import { LoginRequestContext, LoginService } from './login.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
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

const requestContext: LoginRequestContext = {
  requestId: 'req-test',
  clientIp: '127.0.0.1',
  userAgent: 'Mozilla/5.0 Test Browser',
  context: LoginContext.WEB,
  deviceName: 'Windows Chrome',
  deviceType: 'desktop',
  browser: 'Chrome',
  operatingSystem: 'Windows'
};

describe('LoginService', () => {
  it('should normalize email before lookup', async () => {
    const { prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue(createUser());

    await service.login(createLoginDto({ email: '  USER@Example.INVALID  ' }), requestContext);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        email: 'user@example.invalid'
      },
      select: expect.any(Object)
    });
  });

  it('should complete a successful login', async () => {
    const { service } = createService();

    await expect(service.login(createLoginDto(), requestContext)).resolves.toMatchObject({
      response: {
        accessToken: 'access-token',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          id: 'user-1',
          email: 'user@example.invalid',
          role: 'USER',
          managerProfile: {
            displayName: 'Manager'
          }
        }
      },
      refreshCookie: {
        value: 'refresh-token'
      }
    });
  });

  it('should verify against the cached dummy password hash when the user is not found', async () => {
    const { passwordService, prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login(createLoginDto(), requestContext)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(passwordService.verifyAgainstDummy).toHaveBeenCalledWith('TestOnlyPass123');
    expect(passwordService.verifyPassword).not.toHaveBeenCalled();
  });

  it('should reject a wrong password with the generic response', async () => {
    const { passwordService, service } = createService();
    passwordService.verifyPassword.mockResolvedValue(false);

    await expectInvalidCredentials(service.login(createLoginDto(), requestContext));
    expect(passwordService.verifyPassword).toHaveBeenCalledWith('password-hash', 'TestOnlyPass123');
    expect(passwordService.verifyAgainstDummy).not.toHaveBeenCalled();
  });

  it('should reject a disabled user with the generic response', async () => {
    const { prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue(createUser({ isActive: false }));

    await expectInvalidCredentials(service.login(createLoginDto(), requestContext));
  });

  it('should reject an unverified user with the generic response', async () => {
    const { prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue(createUser({ emailVerifiedAt: null }));

    await expectInvalidCredentials(service.login(createLoginDto(), requestContext));
  });

  it('should keep all credential failure responses equivalent for the same request id', async () => {
    const scenarios = [
      () => {
        const setup = createService();
        setup.prisma.user.findUnique.mockResolvedValue(null);
        return setup.service.login(createLoginDto(), requestContext);
      },
      () => {
        const setup = createService();
        setup.passwordService.verifyPassword.mockResolvedValue(false);
        return setup.service.login(createLoginDto(), requestContext);
      },
      () => {
        const setup = createService();
        setup.prisma.user.findUnique.mockResolvedValue(createUser({ isActive: false }));
        return setup.service.login(createLoginDto(), requestContext);
      },
      () => {
        const setup = createService();
        setup.prisma.user.findUnique.mockResolvedValue(createUser({ emailVerifiedAt: null }));
        return setup.service.login(createLoginDto(), requestContext);
      }
    ];
    const responses = [];

    for (const scenario of scenarios) {
      try {
        await scenario();
      } catch (error) {
        responses.push((error as UnauthorizedException).getResponse());
      }
    }

    expect(new Set(responses.map((response) => JSON.stringify(response))).size).toBe(1);
  });

  it('should write LoginAttempt and AuditLog for successful login', async () => {
    const { transaction, service } = createService();

    await service.login(createLoginDto(), requestContext);

    expect(transaction.loginAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        emailHash: 'hash-email',
        success: true,
        failureReason: null,
        ipHash: 'hash-ip',
        userAgentHash: 'hash-user-agent',
        context: LoginContext.WEB
      })
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.LOGIN_SUCCEEDED,
        entityType: 'User',
        entityId: 'user-1',
        metadata: {
          context: LoginContext.WEB,
          deviceType: 'desktop',
          browser: 'Chrome',
          operatingSystem: 'Windows'
        },
        ipHash: 'hash-ip'
      })
    });
  });

  it('should write LoginAttempt and AuditLog for failed login', async () => {
    const { passwordService, transaction, service } = createService();
    passwordService.verifyPassword.mockResolvedValue(false);

    await expectInvalidCredentials(service.login(createLoginDto(), requestContext));

    expect(transaction.loginAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        success: false,
        failureReason: 'INVALID_PASSWORD',
        emailHash: 'hash-email',
        ipHash: 'hash-ip',
        context: LoginContext.WEB
      })
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: null,
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.LOGIN_FAILED,
        metadata: {
          context: LoginContext.WEB,
          deviceType: 'desktop',
          browser: 'Chrome',
          operatingSystem: 'Windows'
        }
      })
    });
  });

  it('should create a session and initial refresh token in the same transaction', async () => {
    const { refreshTokenService, sessionService, transaction, service } = createService();

    await service.login(createLoginDto(), requestContext);

    expect(sessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tokenFamilyId: expect.any(String),
        deviceName: 'Windows Chrome',
        deviceType: 'desktop',
        browser: 'Chrome',
        operatingSystem: 'Windows',
        ipHash: 'hash-ip',
        userAgentHash: 'hash-user-agent',
        expiresAt: expect.any(Date)
      }),
      transaction
    );
    expect(refreshTokenService.issueInitialToken).toHaveBeenCalledWith(
      'session-1',
      expect.any(Date),
      transaction
    );
  });

  it('should issue an access token using the role stored in the database', async () => {
    const { accessTokenService, prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue(createUser({ role: 'ADMIN' }));

    await service.login(createLoginDto(), requestContext);

    expect(accessTokenService.signAccessToken).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'ADMIN',
      sessionId: 'session-1'
    });
  });

  it('should treat ADMIN context as metadata without elevating a USER role', async () => {
    const { accessTokenService, transaction, service } = createService();

    await service.login(createLoginDto({ context: LoginContext.ADMIN }), {
      ...requestContext,
      context: LoginContext.ADMIN
    });

    expect(accessTokenService.signAccessToken).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1'
    });
    expect(transaction.loginAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        success: true,
        context: LoginContext.ADMIN
      })
    });
  });

  it('should update lastLoginAt after successful login', async () => {
    const { transaction, service } = createService();

    await service.login(createLoginDto(), requestContext);

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: {
        id: 'user-1'
      },
      data: {
        lastLoginAt: expect.any(Date)
      }
    });
  });

  it('should not issue refresh or access tokens when session creation fails', async () => {
    const { accessTokenService, refreshTokenService, sessionService, service } = createService();
    sessionService.createSession.mockRejectedValue(new Error('session failed'));

    await expect(service.login(createLoginDto(), requestContext)).rejects.toThrow('session failed');
    expect(refreshTokenService.issueInitialToken).not.toHaveBeenCalled();
    expect(accessTokenService.signAccessToken).not.toHaveBeenCalled();
  });

  it('should not write raw email, raw IP, password, or tokens into audit metadata', async () => {
    const { transaction, service } = createService();

    await service.login(createLoginDto(), requestContext);

    const auditPayload = JSON.stringify(transaction.auditLog.create.mock.calls);
    expect(auditPayload).not.toContain('user@example.invalid');
    expect(auditPayload).not.toContain('127.0.0.1');
    expect(auditPayload).not.toContain('TestOnlyPass123');
    expect(auditPayload).not.toContain('refresh-token');
    expect(auditPayload).not.toContain('access-token');
  });
});

function createService() {
  const transaction = {
    user: {
      update: vi.fn(async () => undefined)
    },
    loginAttempt: {
      create: vi.fn(async () => undefined)
    },
    auditLog: {
      create: vi.fn(async () => undefined)
    }
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async (): Promise<LoginUserFixture | null> => createUser())
    },
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<void>) =>
      callback(transaction)
    )
  };
  const passwordService = {
    verifyPassword: vi.fn(async () => true),
    verifyAgainstDummy: vi.fn(async () => false)
  };
  const sessionService = {
    createSession: vi.fn(async () => ({ id: 'session-1' }))
  };
  const refreshTokenService = {
    issueInitialToken: vi.fn(async () => ({
      token: 'refresh-token',
      tokenHash: 'refresh-token-hash',
      expiresAt: new Date('2026-01-01T00:00:00.000Z')
    }))
  };
  const accessTokenService = {
    signAccessToken: vi.fn(() => 'access-token')
  };
  const tokenHashService = {
    hashToken: vi.fn((value: string) => {
      const [kind] = value.split(':');
      return `hash-${kind}`;
    })
  };
  const rateLimitService = {
    consumeLoginAttempt: vi.fn(async () => undefined)
  };
  const service = new LoginService(
    prisma as unknown as PrismaService,
    passwordService as unknown as PasswordService,
    sessionService as unknown as SessionService,
    refreshTokenService as unknown as RefreshTokenService,
    accessTokenService as unknown as AccessTokenService,
    tokenHashService as unknown as TokenHashService,
    rateLimitService as unknown as LoginRateLimitService,
    config
  );

  return {
    prisma,
    transaction,
    passwordService,
    sessionService,
    refreshTokenService,
    accessTokenService,
    tokenHashService,
    rateLimitService,
    service
  };
}

function createLoginDto(overrides: Partial<Parameters<LoginService['login']>[0]> = {}) {
  return {
    email: 'user@example.invalid',
    password: 'TestOnlyPass123',
    ...overrides
  };
}

function createUser(overrides: Partial<LoginUserFixture> = {}): LoginUserFixture {
  return {
    id: 'user-1',
    email: 'user@example.invalid',
    passwordHash: 'password-hash',
    role: 'USER',
    isActive: true,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    managerProfile: {
      displayName: 'Manager'
    },
    ...overrides
  };
}

type LoginUserFixture = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  managerProfile: {
    displayName: string;
  } | null;
};

async function expectInvalidCredentials(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'E-posta veya şifre hatalı.',
        requestId: 'req-test'
      }
    });
    return;
  }

  throw new Error('Expected invalid credentials exception');
}

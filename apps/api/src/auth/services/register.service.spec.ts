import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { describe, expect, it, vi } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { REGISTER_ACCEPTED_RESPONSE } from '../dto/register.dto';
import { PasswordService, PasswordValidationError } from './password.service';
import { RegisterRateLimitService } from './register-rate-limit.service';
import { RegisterService } from './register.service';
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

describe('RegisterService', () => {
  it('should normalize email before creating a user', async () => {
    const { transaction, service } = createService();

    await service.register(createRegisterDto({ email: '  USER@Example.INVALID  ' }));

    expect(transaction.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.invalid' },
      select: { id: true }
    });
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'user@example.invalid'
      }),
      select: { id: true }
    });
  });

  it('should create a valid registration in one transaction', async () => {
    const { prisma, transaction, service } = createService();

    await expect(service.register(createRegisterDto())).resolves.toEqual(REGISTER_ACCEPTED_RESPONSE);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transaction.user.create).toHaveBeenCalledOnce();
    expect(transaction.managerProfile.create).toHaveBeenCalledOnce();
    expect(transaction.emailVerificationToken.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('should use PasswordService and never store the plain password', async () => {
    const { passwordService, transaction, service } = createService();

    await service.register(createRegisterDto({ password: 'TestOnlyPass123' }));

    expect(passwordService.hashPassword).toHaveBeenCalledWith('TestOnlyPass123');
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        passwordHash: 'hashed-password'
      }),
      select: { id: true }
    });
    expect(JSON.stringify(transaction.user.create.mock.calls)).not.toContain('TestOnlyPass123');
  });

  it('should force the USER role and active unverified account state', async () => {
    const { transaction, service } = createService();

    await service.register(createRegisterDto());

    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'USER',
        isActive: true,
        emailVerifiedAt: null
      }),
      select: { id: true }
    });
  });

  it('should create a manager profile with defaults', async () => {
    const { transaction, service } = createService();

    await service.register(createRegisterDto({ displayName: '  Manager Name  ' }));

    expect(transaction.managerProfile.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        displayName: 'Manager Name',
        locale: 'tr-TR',
        timezone: 'Europe/Istanbul'
      }
    });
  });

  it('should hash and store the email verification token only', async () => {
    const { tokenHashService, transaction, service } = createService();

    await service.register(createRegisterDto());

    expect(tokenHashService.generateOpaqueToken).toHaveBeenCalledOnce();
    expect(tokenHashService.hashToken).toHaveBeenCalledWith('opaque-verification-fixture');
    expect(transaction.emailVerificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tokenHash: 'hashed-verification-token',
        usedAt: null,
        revokedAt: null
      })
    });
    expect(JSON.stringify(transaction.emailVerificationToken.create.mock.calls)).not.toContain(
      'opaque-verification-fixture'
    );
  });

  it('should revoke previous unused verification tokens before creating a new one', async () => {
    const { transaction, service } = createService();

    await service.register(createRegisterDto());

    expect(transaction.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        usedAt: null,
        revokedAt: null
      },
      data: {
        revokedAt: expect.any(Date)
      }
    });
  });

  it('should create an allowlisted audit log', async () => {
    const { transaction, service } = createService();

    await service.register(
      createRegisterDto({
        locale: 'en-US',
        timezone: 'Europe/London'
      })
    );

    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        action: AUTH_AUDIT_EVENTS.REGISTERED,
        entityType: 'User',
        entityId: 'user-1',
        metadata: {
          context: 'WEB',
          locale: 'en-US',
          timezone: 'Europe/London'
        }
      }
    });
    expect(JSON.stringify(transaction.auditLog.create.mock.calls)).not.toContain('user@example.invalid');
  });

  it('should return the same generic response for duplicate email', async () => {
    const { transaction, service } = createService();
    transaction.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(service.register(createRegisterDto())).resolves.toEqual(REGISTER_ACCEPTED_RESPONSE);
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('should swallow unique constraint races and return a generic response', async () => {
    const { transaction, service } = createService();
    transaction.user.create.mockRejectedValue(createUniqueConstraintError());

    await expect(service.register(createRegisterDto())).resolves.toEqual(REGISTER_ACCEPTED_RESPONSE);
  });

  it('should reject invalid emails', async () => {
    const { service } = createService();

    await expect(service.register(createRegisterDto({ email: 'not-an-email' }))).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('should reject invalid passwords', async () => {
    const { passwordService, service } = createService();
    passwordService.hashPassword.mockRejectedValue(new PasswordValidationError('Password is too weak'));

    await expect(service.register(createRegisterDto())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject invalid display names', async () => {
    const { service } = createService();

    await expect(service.register(createRegisterDto({ displayName: 'A' }))).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('should roll back the transaction when a later write fails', async () => {
    const { transaction, service } = createService();
    transaction.managerProfile.create.mockRejectedValue(new Error('profile failed'));

    await expect(service.register(createRegisterDto())).rejects.toThrow('profile failed');
    expect(transaction.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });
});

function createService() {
  const transaction = {
    user: {
      findUnique: vi.fn(async () => null as null | { id: string }),
      create: vi.fn(async () => ({ id: 'user-1' }))
    },
    managerProfile: {
      create: vi.fn(async () => undefined)
    },
    emailVerificationToken: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => undefined)
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
  const passwordService = {
    hashPassword: vi.fn(async () => 'hashed-password')
  };
  const tokenHashService = {
    generateOpaqueToken: vi.fn(() => 'opaque-verification-fixture'),
    hashToken: vi.fn(() => 'hashed-verification-token')
  };
  const rateLimitService = {
    consumeRegisterAttempt: vi.fn(async () => undefined)
  };
  const service = new RegisterService(
    prisma as unknown as PrismaService,
    passwordService as unknown as PasswordService,
    tokenHashService as unknown as TokenHashService,
    rateLimitService as unknown as RegisterRateLimitService,
    config
  );

  return {
    prisma,
    transaction,
    passwordService,
    tokenHashService,
    rateLimitService,
    service
  };
}

function createRegisterDto(overrides: Partial<Parameters<RegisterService['register']>[0]> = {}) {
  return {
    email: 'user@example.invalid',
    password: 'TestOnlyPass123',
    displayName: 'Manager',
    ...overrides
  };
}

function createUniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test-client',
    meta: {
      target: ['email']
    }
  });
}

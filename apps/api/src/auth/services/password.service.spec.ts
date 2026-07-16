import { describe, expect, it, vi } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
import { PasswordService, PasswordValidationError } from './password.service';

const baseConfig: AuthConfig = {
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

describe('PasswordService', () => {
  it('should hash a valid password with Argon2id', async () => {
    const service = new PasswordService(baseConfig);

    const hash = await service.hashPassword('ValidPass123');

    expect(hash).toContain('$argon2id$');
    expect(hash).not.toContain('ValidPass123');
  });

  it('should reject too short passwords', async () => {
    const service = new PasswordService(baseConfig);

    await expect(service.hashPassword('Short1')).rejects.toBeInstanceOf(PasswordValidationError);
  });

  it('should reject too long passwords before hashing', async () => {
    const service = new PasswordService(baseConfig);

    await expect(service.hashPassword(`A1${'x'.repeat(129)}`)).rejects.toBeInstanceOf(
      PasswordValidationError
    );
  });

  it('should reject passwords without a letter', async () => {
    const service = new PasswordService(baseConfig);

    await expect(service.hashPassword('1234567890')).rejects.toBeInstanceOf(PasswordValidationError);
  });

  it('should reject passwords without a number', async () => {
    const service = new PasswordService(baseConfig);

    await expect(service.hashPassword('OnlyLetters')).rejects.toBeInstanceOf(PasswordValidationError);
  });

  it('should normalize unicode passwords before hashing and verification', async () => {
    const service = new PasswordService(baseConfig);
    const composed = 'Cafe\u00e912345';
    const decomposed = 'Cafe\u0065\u030112345';

    const hash = await service.hashPassword(composed);

    await expect(service.verifyPassword(hash, decomposed)).resolves.toBe(true);
  });

  it('should reject null bytes', async () => {
    const service = new PasswordService(baseConfig);

    await expect(service.hashPassword('Valid1234\0')).rejects.toBeInstanceOf(PasswordValidationError);
  });

  it('should verify the correct password', async () => {
    const service = new PasswordService(baseConfig);
    const hash = await service.hashPassword('ValidPass123');

    await expect(service.verifyPassword(hash, 'ValidPass123')).resolves.toBe(true);
  });

  it('should reject the wrong password during verification', async () => {
    const service = new PasswordService(baseConfig);
    const hash = await service.hashPassword('ValidPass123');

    await expect(service.verifyPassword(hash, 'WrongPass123')).resolves.toBe(false);
  });

  it('should return false for an invalid Argon2 hash without leaking the exception', async () => {
    const service = new PasswordService(baseConfig);

    await expect(service.verifyPassword('not-an-argon2-hash', 'ValidPass123')).resolves.toBe(false);
  });

  it('should generate a cached dummy Argon2id hash with the configured cost parameters', async () => {
    const service = new PasswordService(baseConfig);

    const firstHash = await service.getDummyPasswordHash();
    const secondHash = await service.getDummyPasswordHash();
    const parameters = parseArgon2Hash(firstHash);

    expect(secondHash).toBe(firstHash);
    expect(parameters.algorithm).toBe('argon2id');
    expect(parameters.memoryCost).toBe(baseConfig.argon2MemoryCost);
    expect(parameters.timeCost).toBe(baseConfig.argon2TimeCost);
    expect(parameters.parallelism).toBe(baseConfig.argon2Parallelism);
  });

  it('should verify dummy passwords through the same verify primitive', async () => {
    const service = new PasswordService(baseConfig);
    const verifySpy = vi.spyOn(service, 'verifyPassword');
    const dummyHash = await service.getDummyPasswordHash();

    await expect(service.verifyAgainstDummy('WrongPass123')).resolves.toBe(false);

    expect(verifySpy).toHaveBeenCalledWith(dummyHash, 'WrongPass123');
  });

  it('should detect hashes that need rehashing', async () => {
    const originalService = new PasswordService(baseConfig);
    const strongerService = new PasswordService({
      ...baseConfig,
      argon2TimeCost: baseConfig.argon2TimeCost + 1
    });
    const hash = await originalService.hashPassword('ValidPass123');

    expect(strongerService.needsRehash(hash)).toBe(true);
  });
});

function parseArgon2Hash(hash: string): {
  algorithm: string;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
} {
  const [, algorithm, , parameters] = hash.split('$');
  const parameterMap = Object.fromEntries(
    parameters.split(',').map((entry) => {
      const [key, value] = entry.split('=');
      return [key, Number(value)];
    })
  );

  return {
    algorithm,
    memoryCost: parameterMap.m,
    timeCost: parameterMap.t,
    parallelism: parameterMap.p
  };
}

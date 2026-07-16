import { describe, expect, it } from 'vitest';
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

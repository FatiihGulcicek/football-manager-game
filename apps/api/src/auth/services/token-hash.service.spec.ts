import { describe, expect, it } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
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

describe('TokenHashService', () => {
  it('should generate base64url opaque tokens with at least 256-bit entropy', () => {
    const service = new TokenHashService(config);

    const token = service.generateOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url').byteLength).toBeGreaterThanOrEqual(32);
  });

  it('should hash tokens with HMAC SHA-256 without exposing the raw token', () => {
    const service = new TokenHashService(config);

    const hash = service.hashToken('raw-token');

    expect(hash).toMatch(/^hmac-sha256:/);
    expect(hash).not.toContain('raw-token');
    expect(hash).toBe(service.hashToken('raw-token'));
  });

  it('should compare matching tokens using the stored hash', () => {
    const service = new TokenHashService(config);
    const hash = service.hashToken('raw-token');

    expect(service.compareToken('raw-token', hash)).toBe(true);
    expect(service.compareToken('other-token', hash)).toBe(false);
  });
});

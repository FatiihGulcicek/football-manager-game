import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from './auth-config.schema';

describe('auth config schema', () => {
  it('should create process-local development keys when local JWT env is omitted', () => {
    const config = loadAuthConfig({
      NODE_ENV: 'development'
    });

    expect(config.jwtActiveKid).toBe('development');
    expect(config.jwtPrivateKey).toContain('BEGIN PRIVATE KEY');
    expect(config.jwtPublicKeys.development).toContain('BEGIN PUBLIC KEY');
    expect(config.tokenPepper.length).toBeGreaterThan(20);
  });

  it('should accept the production __Host refresh cookie policy', () => {
    const config = loadAuthConfig({
      NODE_ENV: 'production',
      JWT_ACTIVE_KID: 'prod',
      JWT_PRIVATE_KEY: 'production-private-key-placeholder',
      JWT_PUBLIC_KEYS_JSON: JSON.stringify({ prod: 'production-public-key-placeholder' }),
      AUTH_TOKEN_PEPPER: 'production-token-pepper-placeholder',
      AUTH_COOKIE_NAME: '__Host-refresh_token',
      AUTH_COOKIE_SECURE: 'true',
      AUTH_COOKIE_SAME_SITE: 'lax',
      AUTH_COOKIE_PATH: '/'
    });

    expect(config.cookieName).toBe('__Host-refresh_token');
    expect(config.cookieSecure).toBe(true);
    expect(config.cookieSameSite).toBe('lax');
    expect(config.cookiePath).toBe('/');
    expect(config.cookieDomain).toBeUndefined();
  });

  it('should reject production refresh cookies with a domain attribute', () => {
    expect(() =>
      loadAuthConfig({
        NODE_ENV: 'production',
        JWT_ACTIVE_KID: 'prod',
        JWT_PRIVATE_KEY: 'production-private-key-placeholder',
        JWT_PUBLIC_KEYS_JSON: JSON.stringify({ prod: 'production-public-key-placeholder' }),
        AUTH_TOKEN_PEPPER: 'production-token-pepper-placeholder',
        AUTH_COOKIE_NAME: '__Host-refresh_token',
        AUTH_COOKIE_SECURE: 'true',
        AUTH_COOKIE_SAME_SITE: 'lax',
        AUTH_COOKIE_PATH: '/',
        AUTH_COOKIE_DOMAIN: 'example.invalid'
      })
    ).toThrow('AUTH_COOKIE_DOMAIN must be empty for __Host- cookies in production');
  });
});

import { generateKeyPairSync } from 'crypto';
import { describe, expect, it } from 'vitest';
import { AuthConfig } from '../../config/auth.config';
import { AccessTokenError, AccessTokenService } from './access-token.service';

const keyPair = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  },
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  }
});

const baseConfig: AuthConfig = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
  emailVerifyTtlSeconds: 86_400,
  passwordResetTtlSeconds: 1_800,
  refreshGraceSeconds: 5,
  jwtIssuer: 'football-manager-auth',
  jwtAudience: 'football-manager-api',
  jwtActiveKid: 'test-key',
  jwtPrivateKey: keyPair.privateKey,
  jwtPublicKeys: {
    'test-key': keyPair.publicKey
  },
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

describe('AccessTokenService', () => {
  it('should sign and verify an ES256 access token', () => {
    const service = new AccessTokenService(baseConfig);

    const token = service.signAccessToken({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      issuedAtSeconds: 100
    });

    expect(service.verifyAccessToken(token, 101)).toMatchObject({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      keyId: 'test-key'
    });
  });

  it('should reject an unknown kid', () => {
    const service = new AccessTokenService(baseConfig);
    const token = replaceHeader(
      service.signAccessToken({
        userId: 'user-1',
        role: 'USER',
        sessionId: 'session-1',
        issuedAtSeconds: 100
      }),
      { kid: 'unknown-key' }
    );

    expect(() => service.verifyAccessToken(token, 101)).toThrow(AccessTokenError);
    expect(() => service.verifyAccessToken(token, 101)).toThrow('TOKEN_UNKNOWN_KID');
  });

  it('should reject invalid signatures', () => {
    const service = new AccessTokenService(baseConfig);
    const token = service.signAccessToken({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      issuedAtSeconds: 100
    });
    const [header, payload] = token.split('.');
    const tamperedToken = `${header}.${payload}.invalid-signature`;

    expect(() => service.verifyAccessToken(tamperedToken, 101)).toThrow('TOKEN_SIGNATURE_INVALID');
  });

  it('should reject the wrong issuer', () => {
    const signingService = new AccessTokenService(baseConfig);
    const verifyingService = new AccessTokenService({
      ...baseConfig,
      jwtIssuer: 'other-issuer'
    });
    const token = signingService.signAccessToken({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      issuedAtSeconds: 100
    });

    expect(() => verifyingService.verifyAccessToken(token, 101)).toThrow('TOKEN_ISSUER_INVALID');
  });

  it('should reject the wrong audience', () => {
    const signingService = new AccessTokenService(baseConfig);
    const verifyingService = new AccessTokenService({
      ...baseConfig,
      jwtAudience: 'other-audience'
    });
    const token = signingService.signAccessToken({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      issuedAtSeconds: 100
    });

    expect(() => verifyingService.verifyAccessToken(token, 101)).toThrow('TOKEN_AUDIENCE_INVALID');
  });

  it('should reject expired tokens outside clock skew', () => {
    const service = new AccessTokenService(baseConfig);
    const token = service.signAccessToken({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      issuedAtSeconds: 100
    });

    expect(() => service.verifyAccessToken(token, 1_011)).toThrow('TOKEN_EXPIRED');
  });

  it('should tolerate small clock skew', () => {
    const service = new AccessTokenService(baseConfig);
    const token = service.signAccessToken({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      issuedAtSeconds: 100
    });

    expect(service.verifyAccessToken(token, 1_005)).toMatchObject({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1'
    });
  });

  it('should include only the expected role, sub, and sid payload values', () => {
    const service = new AccessTokenService(baseConfig);

    const token = service.signAccessToken({
      userId: 'user-1',
      role: 'ADMIN',
      sessionId: 'session-1',
      issuedAtSeconds: 100
    });

    const payload = decodePayload(token);

    expect(payload).toMatchObject({
      sub: 'user-1',
      role: 'ADMIN',
      sid: 'session-1',
      iss: 'football-manager-auth',
      aud: 'football-manager-api'
    });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('displayName');
  });
});

function replaceHeader(token: string, changes: Record<string, string>): string {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<
    string,
    string
  >;
  const nextHeader = Buffer.from(JSON.stringify({ ...header, ...changes })).toString('base64url');

  return `${nextHeader}.${encodedPayload}.${encodedSignature}`;
}

function decodePayload(token: string): Record<string, unknown> {
  const [, encodedPayload] = token.split('.');
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

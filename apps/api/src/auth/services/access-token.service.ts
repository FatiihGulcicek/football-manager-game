import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPrivateKey, createPublicKey, sign, verify } from 'crypto';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';

type JwtHeader = {
  alg: 'ES256';
  kid: string;
  typ: 'JWT';
};

type JwtPayload = {
  sub: string;
  role: string;
  sid: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
};

export type AccessTokenInput = {
  userId: string;
  role: string;
  sessionId: string;
  issuedAtSeconds?: number;
};

export type VerifiedAccessToken = {
  userId: string;
  role: string;
  sessionId: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  keyId: string;
};

export class AccessTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessTokenError';
  }
}

@Injectable()
export class AccessTokenService {
  private readonly clockToleranceSeconds = 10;

  constructor(@Optional() @Inject(AUTH_CONFIG) private readonly config: AuthConfig = authConfig) {}

  signAccessToken(input: AccessTokenInput): string {
    const issuedAt = input.issuedAtSeconds ?? nowInSeconds();
    const header: JwtHeader = {
      alg: 'ES256',
      kid: this.config.jwtActiveKid,
      typ: 'JWT'
    };
    const payload: JwtPayload = {
      sub: input.userId,
      role: input.role,
      sid: input.sessionId,
      iat: issuedAt,
      exp: issuedAt + this.config.accessTokenTtlSeconds,
      iss: this.config.jwtIssuer,
      aud: this.config.jwtAudience
    };
    const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
    const signature = sign('sha256', Buffer.from(signingInput), {
      key: createPrivateKey(this.config.jwtPrivateKey),
      dsaEncoding: 'ieee-p1363'
    });

    return `${signingInput}.${signature.toString('base64url')}`;
  }

  verifyAccessToken(token: string, currentTimeSeconds = nowInSeconds()): VerifiedAccessToken {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');

    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new AccessTokenError('TOKEN_MALFORMED');
    }

    const header = parseHeader(encodedHeader);
    const payload = parsePayload(encodedPayload);

    if (header.alg !== 'ES256') {
      throw new AccessTokenError('TOKEN_ALGORITHM_UNSUPPORTED');
    }

    const publicKey = this.config.jwtPublicKeys[header.kid];

    if (!publicKey) {
      throw new AccessTokenError('TOKEN_UNKNOWN_KID');
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = Buffer.from(encodedSignature, 'base64url');
    const isValidSignature = verify('sha256', Buffer.from(signingInput), {
      key: createPublicKey(publicKey),
      dsaEncoding: 'ieee-p1363'
    }, signature);

    if (!isValidSignature) {
      throw new AccessTokenError('TOKEN_SIGNATURE_INVALID');
    }

    if (payload.iss !== this.config.jwtIssuer) {
      throw new AccessTokenError('TOKEN_ISSUER_INVALID');
    }

    if (payload.aud !== this.config.jwtAudience) {
      throw new AccessTokenError('TOKEN_AUDIENCE_INVALID');
    }

    if (payload.iat - this.clockToleranceSeconds > currentTimeSeconds) {
      throw new AccessTokenError('TOKEN_NOT_YET_VALID');
    }

    if (payload.exp + this.clockToleranceSeconds < currentTimeSeconds) {
      throw new AccessTokenError('TOKEN_EXPIRED');
    }

    return {
      userId: payload.sub,
      role: payload.role,
      sessionId: payload.sid,
      issuedAtSeconds: payload.iat,
      expiresAtSeconds: payload.exp,
      keyId: header.kid
    };
  }
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function encodeJson(value: JwtHeader | JwtPayload): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseHeader(encodedHeader: string): JwtHeader {
  const value = parseJson(encodedHeader);

  if (
    value.alg !== 'ES256' ||
    typeof value.kid !== 'string' ||
    value.kid.length === 0 ||
    value.typ !== 'JWT'
  ) {
    throw new AccessTokenError('TOKEN_HEADER_INVALID');
  }

  return {
    alg: value.alg,
    kid: value.kid,
    typ: value.typ
  };
}

function parsePayload(encodedPayload: string): JwtPayload {
  const value = parseJson(encodedPayload);

  if (
    typeof value.sub !== 'string' ||
    typeof value.role !== 'string' ||
    typeof value.sid !== 'string' ||
    typeof value.iat !== 'number' ||
    typeof value.exp !== 'number' ||
    typeof value.iss !== 'string' ||
    typeof value.aud !== 'string'
  ) {
    throw new AccessTokenError('TOKEN_PAYLOAD_INVALID');
  }

  return {
    sub: value.sub,
    role: value.role,
    sid: value.sid,
    iat: value.iat,
    exp: value.exp,
    iss: value.iss,
    aud: value.aud
  };
}

function parseJson(encodedValue: string): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(encodedValue, 'base64url').toString('utf8')) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AccessTokenError('TOKEN_JSON_INVALID');
  }

  return parsed as Record<string, unknown>;
}

import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { authConfig, AuthConfig } from '../../config/auth.config';

const TOKEN_BYTES = 32;
const HASH_PREFIX = 'hmac-sha256';

@Injectable()
export class TokenHashService {
  constructor(private readonly config: AuthConfig = authConfig) {}

  generateOpaqueToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
  }

  hashToken(token: string): string {
    const digest = createHmac('sha256', this.config.tokenPepper).update(token).digest('base64url');
    return `${HASH_PREFIX}:${digest}`;
  }

  compareToken(token: string, hash: string): boolean {
    const expected = this.hashToken(token);
    const expectedBuffer = Buffer.from(expected);
    const hashBuffer = Buffer.from(hash);

    if (expectedBuffer.length !== hashBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, hashBuffer);
  }
}

import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { RedisService } from '../../redis/redis.service';
import { TokenHashService } from './token-hash.service';
import {
  AUTH_RATE_LIMIT_ACTIONS,
  AuthRateLimitService
} from './auth-rate-limit.service';

describe('AuthRateLimitService', () => {
  it('should allow requests until the fixed-window limit is reached', async () => {
    const { redis, service } = createService();

    const first = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP,
      identifiers: ['ip:127.0.0.1'],
      limit: 2,
      windowSeconds: 60
    });
    const second = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP,
      identifiers: ['ip:127.0.0.1'],
      limit: 2,
      windowSeconds: 60
    });
    const third = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP,
      identifiers: ['ip:127.0.0.1'],
      limit: 2,
      windowSeconds: 60
    });

    expect(first.allowed).toBe(true);
    expect(first.results[0]).toMatchObject({ count: 1, remaining: 1, retryAfterSeconds: 60 });
    expect(second.allowed).toBe(true);
    expect(second.results[0]).toMatchObject({ count: 2, remaining: 0 });
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(redis.keys()).toHaveLength(1);
  });

  it('should assign a TTL atomically without extending it on later attempts', async () => {
    const { redis, service } = createService();

    await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.REGISTER_IP,
      identifiers: ['ip:203.0.113.10'],
      limit: 10,
      windowSeconds: 120
    });
    redis.advanceSeconds(30);
    const second = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.REGISTER_IP,
      identifiers: ['ip:203.0.113.10'],
      limit: 10,
      windowSeconds: 120
    });

    expect(second.results[0].retryAfterSeconds).toBe(90);
  });

  it('should reset the counter after the fixed window expires', async () => {
    const { redis, service } = createService();

    await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.FORGOT_PASSWORD_IP,
      identifiers: ['ip:198.51.100.2'],
      limit: 1,
      windowSeconds: 10
    });
    redis.advanceSeconds(11);
    const afterExpiry = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.FORGOT_PASSWORD_IP,
      identifiers: ['ip:198.51.100.2'],
      limit: 1,
      windowSeconds: 10
    });

    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.results[0]).toMatchObject({ count: 1, remaining: 0, retryAfterSeconds: 10 });
  });

  it('should keep actions and identifiers isolated with versioned keys', async () => {
    const { redis, service } = createService();

    await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP,
      identifiers: ['shared-identifier'],
      limit: 1,
      windowSeconds: 60
    });
    const differentAction = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_ACCOUNT,
      identifiers: ['shared-identifier'],
      limit: 1,
      windowSeconds: 60
    });
    const differentIdentifier = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP,
      identifiers: ['another-identifier'],
      limit: 1,
      windowSeconds: 60
    });

    expect(differentAction.allowed).toBe(true);
    expect(differentIdentifier.allowed).toBe(true);
    expect(redis.keys().every((key) => key.startsWith('auth:rl:v1:'))).toBe(true);
    expect(redis.keys().join('\n')).not.toContain('shared-identifier');
    expect(redis.keys()).toHaveLength(3);
  });

  it('should fail open and log a safe warning when Redis is unavailable', async () => {
    const loggerSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new AuthRateLimitService(
      {
        eval: vi.fn(async () => {
          throw new Error('redis unavailable for raw-token-value');
        })
      } as unknown as RedisService,
      createHashingTokenService() as unknown as TokenHashService
    );

    try {
      const result = await service.consume({
        action: AUTH_RATE_LIMIT_ACTIONS.REFRESH_IP,
        identifiers: ['raw-token-value'],
        limit: 1,
        windowSeconds: 60
      });

      expect(result.allowed).toBe(true);
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Auth rate limit fail-open for REFRESH_IP')
      );
      expect(loggerSpy.mock.calls.flat().join('\n')).not.toContain('raw-token-value');
    } finally {
      loggerSpy.mockRestore();
    }
  });

  it('should fail open when Redis returns a malformed result', async () => {
    const loggerSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new AuthRateLimitService(
      {
        eval: vi.fn(async () => ['not-a-count', 60])
      } as unknown as RedisService,
      createHashingTokenService() as unknown as TokenHashService
    );

    try {
      const result = await service.consume({
        action: AUTH_RATE_LIMIT_ACTIONS.RESET_PASSWORD_TOKEN,
        identifiers: ['token-hash'],
        limit: 1,
        windowSeconds: 60
      });

      expect(result.allowed).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('malformed_redis_result')
      );
    } finally {
      loggerSpy.mockRestore();
    }
  });

  it('should deny the second request when the limit is one', async () => {
    const { service } = createService();

    await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.VERIFY_EMAIL_TOKEN,
      identifiers: ['token-hash'],
      limit: 1,
      windowSeconds: 60
    });
    const second = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.VERIFY_EMAIL_TOKEN,
      identifiers: ['token-hash'],
      limit: 1,
      windowSeconds: 60
    });

    expect(second.allowed).toBe(false);
    expect(second.results[0].count).toBe(2);
  });

  it('should allow exactly the configured boundary under concurrent pressure', async () => {
    const { service } = createService();
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.consume({
          action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP_ACCOUNT,
          identifiers: ['ip-account:fixture'],
          limit: 20,
          windowSeconds: 60
        })
      )
    );
    const next = await service.consume({
      action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP_ACCOUNT,
      identifiers: ['ip-account:fixture'],
      limit: 20,
      windowSeconds: 60
    });

    expect(attempts.every((attempt) => attempt.allowed)).toBe(true);
    expect(next.allowed).toBe(false);
  });

  it('should reject invalid limiter configuration before touching Redis', async () => {
    const { redis, service } = createService();

    await expect(
      service.consume({
        action: AUTH_RATE_LIMIT_ACTIONS.RESEND_VERIFICATION_ACCOUNT,
        identifiers: ['account-hash'],
        limit: 0,
        windowSeconds: 60
      })
    ).rejects.toThrow('Invalid auth rate limit');
    expect(redis.evalCalls).toHaveLength(0);
  });
});

function createService() {
  const redis = new FakeRedisService();
  const service = new AuthRateLimitService(
    redis as unknown as RedisService,
    createHashingTokenService() as unknown as TokenHashService
  );

  return {
    redis,
    service
  };
}

function createHashingTokenService(): Pick<TokenHashService, 'hashToken'> {
  return {
    hashToken: (value: string) =>
      `hmac-sha256:${createHash('sha256').update(value).digest('base64url')}`
  };
}

class FakeRedisService {
  private nowSeconds = 0;
  private readonly store = new Map<string, { count: number; expiresAtSeconds: number }>();
  readonly evalCalls: Array<{ script: string; numberOfKeys: number; args: Array<string | number> }> = [];

  async eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<[number, number]> {
    this.evalCalls.push({ script, numberOfKeys, args });
    const [key, windowSecondsInput] = args;

    if (typeof key !== 'string' || typeof windowSecondsInput !== 'number') {
      throw new Error('invalid fake redis input');
    }

    const existing = this.store.get(key);

    if (existing && existing.expiresAtSeconds <= this.nowSeconds) {
      this.store.delete(key);
    }

    const current = this.store.get(key);

    if (!current) {
      this.store.set(key, {
        count: 1,
        expiresAtSeconds: this.nowSeconds + windowSecondsInput
      });
      return [1, windowSecondsInput];
    }

    current.count += 1;
    return [current.count, current.expiresAtSeconds - this.nowSeconds];
  }

  advanceSeconds(seconds: number): void {
    this.nowSeconds += seconds;
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { TokenHashService } from './token-hash.service';

const RATE_LIMIT_KEY_PREFIX = 'auth:rl:v1';
const HASH_PURPOSE_PREFIX = 'auth-rate-limit';

const FIXED_WINDOW_LUA_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

export const AUTH_RATE_LIMIT_ACTIONS = {
  REGISTER_IP: 'REGISTER_IP',
  REGISTER_EMAIL: 'REGISTER_EMAIL',
  LOGIN_IP: 'LOGIN_IP',
  LOGIN_ACCOUNT: 'LOGIN_ACCOUNT',
  LOGIN_IP_ACCOUNT: 'LOGIN_IP_ACCOUNT',
  REFRESH_IP: 'REFRESH_IP',
  REFRESH_SESSION: 'REFRESH_SESSION',
  FORGOT_PASSWORD_IP: 'FORGOT_PASSWORD_IP',
  FORGOT_PASSWORD_ACCOUNT: 'FORGOT_PASSWORD_ACCOUNT',
  RESET_PASSWORD_IP: 'RESET_PASSWORD_IP',
  RESET_PASSWORD_TOKEN: 'RESET_PASSWORD_TOKEN',
  RESEND_VERIFICATION_IP: 'RESEND_VERIFICATION_IP',
  RESEND_VERIFICATION_ACCOUNT: 'RESEND_VERIFICATION_ACCOUNT',
  VERIFY_EMAIL_IP: 'VERIFY_EMAIL_IP',
  VERIFY_EMAIL_TOKEN: 'VERIFY_EMAIL_TOKEN'
} as const;

export type AuthRateLimitAction =
  (typeof AUTH_RATE_LIMIT_ACTIONS)[keyof typeof AUTH_RATE_LIMIT_ACTIONS];

export type AuthRateLimitConsumeInput = {
  action: AuthRateLimitAction;
  identifiers: string[];
  limit: number;
  windowSeconds: number;
};

export type AuthRateLimitBucketInput = {
  action: AuthRateLimitAction;
  identifier: string;
  limit: number;
  windowSeconds: number;
};

export type AuthRateLimitBucketResult = {
  action: AuthRateLimitAction;
  key: string;
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAfterSeconds: number;
};

export type AuthRateLimitConsumeResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  results: AuthRateLimitBucketResult[];
};

@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);

  constructor(
    @Inject(RedisService) private readonly redisService: RedisService,
    @Inject(TokenHashService) private readonly tokenHashService: TokenHashService
  ) {}

  consume(input: AuthRateLimitConsumeInput): Promise<AuthRateLimitConsumeResult> {
    return this.consumeMany(
      input.identifiers.map((identifier) => ({
        action: input.action,
        identifier,
        limit: input.limit,
        windowSeconds: input.windowSeconds
      }))
    );
  }

  async consumeMany(buckets: AuthRateLimitBucketInput[]): Promise<AuthRateLimitConsumeResult> {
    const results: AuthRateLimitBucketResult[] = [];

    for (const bucket of buckets) {
      this.assertValidBucket(bucket);
      const result = await this.consumeBucket(bucket);

      if (!result) {
        return {
          allowed: true,
          retryAfterSeconds: 0,
          results: []
        };
      }

      results.push(result);
    }

    const deniedResult = results.find((result) => !result.allowed);

    return {
      allowed: !deniedResult,
      retryAfterSeconds: deniedResult?.retryAfterSeconds ?? 0,
      results
    };
  }

  private async consumeBucket(
    bucket: AuthRateLimitBucketInput
  ): Promise<AuthRateLimitBucketResult | null> {
    const key = this.createKey(bucket.action, bucket.identifier);

    try {
      const redisResult = await this.redisService.eval(
        FIXED_WINDOW_LUA_SCRIPT,
        1,
        key,
        bucket.windowSeconds
      );
      const parsedResult = parseRedisResult(redisResult);

      if (!parsedResult) {
        this.warnFailOpen(bucket.action, 'malformed_redis_result');
        return null;
      }

      const retryAfterSeconds =
        parsedResult.ttlSeconds > 0 ? parsedResult.ttlSeconds : bucket.windowSeconds;
      const remaining = Math.max(bucket.limit - parsedResult.count, 0);

      return {
        action: bucket.action,
        key,
        allowed: parsedResult.count <= bucket.limit,
        count: parsedResult.count,
        remaining,
        retryAfterSeconds,
        resetAfterSeconds: retryAfterSeconds
      };
    } catch (error) {
      this.warnFailOpen(bucket.action, error instanceof Error ? error.name : 'redis_error');
      return null;
    }
  }

  private createKey(action: AuthRateLimitAction, identifier: string): string {
    const hashParts = this.tokenHashService
      .hashToken(`${HASH_PURPOSE_PREFIX}:${action}:${identifier}`)
      .split(':');
    const identifierHash = hashParts[hashParts.length - 1];

    return `${RATE_LIMIT_KEY_PREFIX}:${action}:${identifierHash ?? 'invalid-hash'}`;
  }

  private assertValidBucket(bucket: AuthRateLimitBucketInput): void {
    if (!Number.isInteger(bucket.limit) || bucket.limit <= 0) {
      throw new Error(`Invalid auth rate limit for ${bucket.action}`);
    }

    if (!Number.isInteger(bucket.windowSeconds) || bucket.windowSeconds <= 0) {
      throw new Error(`Invalid auth rate limit window for ${bucket.action}`);
    }

    if (typeof bucket.identifier !== 'string' || bucket.identifier.length === 0) {
      throw new Error(`Invalid auth rate limit identifier for ${bucket.action}`);
    }
  }

  private warnFailOpen(action: AuthRateLimitAction, reason: string): void {
    this.logger.warn(`Auth rate limit fail-open for ${action}: ${reason}`);
  }
}

function parseRedisResult(result: unknown): { count: number; ttlSeconds: number } | null {
  if (!Array.isArray(result) || result.length < 2) {
    return null;
  }

  const count = Number(result[0]);
  const ttlSeconds = Number(result[1]);

  if (!Number.isFinite(count) || !Number.isFinite(ttlSeconds)) {
    return null;
  }

  if (count < 0 || ttlSeconds === 0) {
    return null;
  }

  return {
    count,
    ttlSeconds
  };
}

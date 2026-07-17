import { AuthConfig, DEFAULT_AUTH_RATE_LIMITS } from '../../config/auth.config';
import { AuthRateLimitExceededException } from '../errors/auth-rate-limit-exceeded.exception';
import { AuthRateLimitConsumeResult } from './auth-rate-limit.service';

export function getConfiguredAuthRateLimits(config: AuthConfig) {
  return config.rateLimits ?? DEFAULT_AUTH_RATE_LIMITS;
}

export function assertAuthRateLimitAllowed(
  result: AuthRateLimitConsumeResult,
  requestId: string
): void {
  if (result.allowed) {
    return;
  }

  throw new AuthRateLimitExceededException(
    requestId,
    Math.max(1, Math.ceil(result.retryAfterSeconds))
  );
}

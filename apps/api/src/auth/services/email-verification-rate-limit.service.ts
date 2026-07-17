import { Inject, Injectable, Optional } from '@nestjs/common';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import {
  assertAuthRateLimitAllowed,
  getConfiguredAuthRateLimits
} from './auth-rate-limit-boundary';
import {
  AUTH_RATE_LIMIT_ACTIONS,
  AuthRateLimitBucketInput,
  AuthRateLimitService
} from './auth-rate-limit.service';

export type EmailVerificationRateLimitInput = {
  tokenHash?: string;
  clientIp?: string;
  requestId: string;
};

@Injectable()
export class EmailVerificationRateLimitService {
  constructor(
    @Optional()
    @Inject(AuthRateLimitService)
    private readonly authRateLimitService?: AuthRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async consumeVerifyEmailAttempt(input: EmailVerificationRateLimitInput): Promise<void> {
    if (!this.authRateLimitService) {
      return;
    }

    const limits = getConfiguredAuthRateLimits(this.config).verifyEmail;
    const buckets: AuthRateLimitBucketInput[] = [];

    if (input.clientIp) {
      buckets.push({
        action: AUTH_RATE_LIMIT_ACTIONS.VERIFY_EMAIL_IP,
        identifier: `ip:${input.clientIp}`,
        limit: limits.ip.limit,
        windowSeconds: limits.ip.windowSeconds
      });
    }

    if (input.tokenHash) {
      buckets.push({
        action: AUTH_RATE_LIMIT_ACTIONS.VERIFY_EMAIL_TOKEN,
        identifier: `token:${input.tokenHash}`,
        limit: limits.token.limit,
        windowSeconds: limits.token.windowSeconds
      });
    }

    const result = await this.authRateLimitService.consumeMany(buckets);

    assertAuthRateLimitAllowed(result, input.requestId);
  }
}

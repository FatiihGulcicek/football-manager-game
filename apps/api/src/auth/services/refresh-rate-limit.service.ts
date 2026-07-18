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

export type RefreshRateLimitInput = {
  ipHash?: string;
  sessionId?: string;
  requestId: string;
};

@Injectable()
export class RefreshRateLimitService {
  constructor(
    @Optional()
    @Inject(AuthRateLimitService)
    private readonly authRateLimitService?: AuthRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async consumeRefreshAttempt(input: RefreshRateLimitInput): Promise<void> {
    if (!this.authRateLimitService) {
      return;
    }

    const limits = getConfiguredAuthRateLimits(this.config).refresh;
    const buckets: AuthRateLimitBucketInput[] = [];

    if (input.ipHash) {
      buckets.push({
        action: AUTH_RATE_LIMIT_ACTIONS.REFRESH_IP,
        identifier: `ip:${input.ipHash}`,
        limit: limits.ip.limit,
        windowSeconds: limits.ip.windowSeconds
      });
    }

    if (input.sessionId) {
      buckets.push({
        action: AUTH_RATE_LIMIT_ACTIONS.REFRESH_SESSION,
        identifier: `session:${input.sessionId}`,
        limit: limits.session.limit,
        windowSeconds: limits.session.windowSeconds
      });
    }

    const result = await this.authRateLimitService.consumeMany(buckets);

    assertAuthRateLimitAllowed(result, input.requestId);
  }
}

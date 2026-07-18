import { Inject, Injectable, Optional } from '@nestjs/common';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import {
  assertAuthRateLimitAllowed,
  getConfiguredAuthRateLimits
} from './auth-rate-limit-boundary';
import { AUTH_RATE_LIMIT_ACTIONS, AuthRateLimitService } from './auth-rate-limit.service';

export type EmailVerificationResendRateLimitInput = {
  emailHash: string;
  clientIp: string;
  requestId: string;
};

@Injectable()
export class EmailVerificationResendRateLimitService {
  constructor(
    @Optional()
    @Inject(AuthRateLimitService)
    private readonly authRateLimitService?: AuthRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async consumeResendVerificationAttempt(
    input: EmailVerificationResendRateLimitInput
  ): Promise<void> {
    if (!this.authRateLimitService) {
      return;
    }

    const limits = getConfiguredAuthRateLimits(this.config).resendVerification;
    const result = await this.authRateLimitService.consumeMany([
      {
        action: AUTH_RATE_LIMIT_ACTIONS.RESEND_VERIFICATION_IP,
        identifier: `ip:${input.clientIp}`,
        limit: limits.ip.limit,
        windowSeconds: limits.ip.windowSeconds
      },
      {
        action: AUTH_RATE_LIMIT_ACTIONS.RESEND_VERIFICATION_ACCOUNT,
        identifier: `account:${input.emailHash}`,
        limit: limits.account.limit,
        windowSeconds: limits.account.windowSeconds
      }
    ]);

    assertAuthRateLimitAllowed(result, input.requestId);
  }
}

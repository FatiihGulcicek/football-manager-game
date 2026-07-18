import { Inject, Injectable, Optional } from '@nestjs/common';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import {
  assertAuthRateLimitAllowed,
  getConfiguredAuthRateLimits
} from './auth-rate-limit-boundary';
import { AUTH_RATE_LIMIT_ACTIONS, AuthRateLimitService } from './auth-rate-limit.service';

export type PasswordResetRateLimitInput = {
  emailHash: string;
  clientIp: string;
  requestId: string;
};

export type ResetPasswordRateLimitInput = {
  tokenHash: string;
  clientIp: string;
  requestId: string;
};

@Injectable()
export class PasswordResetRateLimitService {
  constructor(
    @Optional()
    @Inject(AuthRateLimitService)
    private readonly authRateLimitService?: AuthRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async consumeForgotPasswordAttempt(input: PasswordResetRateLimitInput): Promise<void> {
    if (!this.authRateLimitService) {
      return;
    }

    const limits = getConfiguredAuthRateLimits(this.config).forgotPassword;
    const result = await this.authRateLimitService.consumeMany([
      {
        action: AUTH_RATE_LIMIT_ACTIONS.FORGOT_PASSWORD_IP,
        identifier: `ip:${input.clientIp}`,
        limit: limits.ip.limit,
        windowSeconds: limits.ip.windowSeconds
      },
      {
        action: AUTH_RATE_LIMIT_ACTIONS.FORGOT_PASSWORD_ACCOUNT,
        identifier: `account:${input.emailHash}`,
        limit: limits.account.limit,
        windowSeconds: limits.account.windowSeconds
      }
    ]);

    assertAuthRateLimitAllowed(result, input.requestId);
  }

  async consumeResetPasswordAttempt(input: ResetPasswordRateLimitInput): Promise<void> {
    if (!this.authRateLimitService) {
      return;
    }

    const limits = getConfiguredAuthRateLimits(this.config).resetPassword;
    const result = await this.authRateLimitService.consumeMany([
      {
        action: AUTH_RATE_LIMIT_ACTIONS.RESET_PASSWORD_IP,
        identifier: `ip:${input.clientIp}`,
        limit: limits.ip.limit,
        windowSeconds: limits.ip.windowSeconds
      },
      {
        action: AUTH_RATE_LIMIT_ACTIONS.RESET_PASSWORD_TOKEN,
        identifier: `token:${input.tokenHash}`,
        limit: limits.token.limit,
        windowSeconds: limits.token.windowSeconds
      }
    ]);

    assertAuthRateLimitAllowed(result, input.requestId);
  }
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import { LoginContext } from '@football-manager/database';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import {
  assertAuthRateLimitAllowed,
  getConfiguredAuthRateLimits
} from './auth-rate-limit-boundary';
import { AUTH_RATE_LIMIT_ACTIONS, AuthRateLimitService } from './auth-rate-limit.service';

export type LoginRateLimitInput = {
  email: string;
  context: LoginContext;
  clientIp: string;
  requestId: string;
};

@Injectable()
export class LoginRateLimitService {
  constructor(
    @Optional()
    @Inject(AuthRateLimitService)
    private readonly authRateLimitService?: AuthRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async consumeLoginAttempt(input: LoginRateLimitInput): Promise<void> {
    if (!this.authRateLimitService) {
      return;
    }

    const limits = getConfiguredAuthRateLimits(this.config).login;
    const result = await this.authRateLimitService.consumeMany([
      {
        action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP,
        identifier: `ip:${input.clientIp}`,
        limit: limits.ip.limit,
        windowSeconds: limits.ip.windowSeconds
      },
      {
        action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_ACCOUNT,
        identifier: `account:${input.email}`,
        limit: limits.account.limit,
        windowSeconds: limits.account.windowSeconds
      },
      {
        action: AUTH_RATE_LIMIT_ACTIONS.LOGIN_IP_ACCOUNT,
        identifier: `ip-account:${input.clientIp}:${input.email}`,
        limit: limits.ipAccount.limit,
        windowSeconds: limits.ipAccount.windowSeconds
      }
    ]);

    assertAuthRateLimitAllowed(result, input.requestId);
  }
}

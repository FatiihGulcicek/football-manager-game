import { Inject, Injectable, Optional } from '@nestjs/common';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import {
  assertAuthRateLimitAllowed,
  getConfiguredAuthRateLimits
} from './auth-rate-limit-boundary';
import { AUTH_RATE_LIMIT_ACTIONS, AuthRateLimitService } from './auth-rate-limit.service';

export type RegisterRateLimitInput = {
  email: string;
  clientIp: string;
  requestId: string;
};

@Injectable()
export class RegisterRateLimitService {
  constructor(
    @Optional()
    @Inject(AuthRateLimitService)
    private readonly authRateLimitService?: AuthRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async consumeRegisterAttempt(input: RegisterRateLimitInput): Promise<void> {
    if (!this.authRateLimitService) {
      return;
    }

    const limits = getConfiguredAuthRateLimits(this.config).register;
    const result = await this.authRateLimitService.consumeMany([
      {
        action: AUTH_RATE_LIMIT_ACTIONS.REGISTER_IP,
        identifier: `ip:${input.clientIp}`,
        limit: limits.ip.limit,
        windowSeconds: limits.ip.windowSeconds
      },
      {
        action: AUTH_RATE_LIMIT_ACTIONS.REGISTER_EMAIL,
        identifier: `email:${input.email}`,
        limit: limits.email.limit,
        windowSeconds: limits.email.windowSeconds
      }
    ]);

    assertAuthRateLimitAllowed(result, input.requestId);
  }
}

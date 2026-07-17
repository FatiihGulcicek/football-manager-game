import { Injectable } from '@nestjs/common';

export type EmailVerificationRateLimitInput = {
  tokenHash?: string;
};

@Injectable()
export class EmailVerificationRateLimitService {
  async consumeVerifyEmailAttempt(_input: EmailVerificationRateLimitInput): Promise<void> {
    // Sprint 4F will attach the Redis-backed verify-email limiter at this boundary.
  }
}

import { Injectable } from '@nestjs/common';

export type PasswordResetRateLimitInput = {
  emailHash: string;
  clientIp: string;
  requestId: string;
};

@Injectable()
export class PasswordResetRateLimitService {
  async consumeForgotPasswordAttempt(_input: PasswordResetRateLimitInput): Promise<void> {
    // Sprint 4F will attach the Redis-backed forgot-password limiter at this boundary.
  }
}

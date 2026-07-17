export type EmailVerificationResendRateLimitInput = {
  emailHash: string;
  clientIp: string;
  requestId: string;
};

export class EmailVerificationResendRateLimitService {
  async consumeResendVerificationAttempt(
    _input: EmailVerificationResendRateLimitInput
  ): Promise<void> {
    // Sprint 4F will attach the Redis-backed resend limiter at this boundary.
  }
}

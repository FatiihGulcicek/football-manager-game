import { Injectable } from '@nestjs/common';

export type RegisterRateLimitInput = {
  email: string;
};

@Injectable()
export class RegisterRateLimitService {
  async consumeRegisterAttempt(_input: RegisterRateLimitInput): Promise<void> {
    // Sprint 4F will attach Redis-backed and bounded fallback limiters here.
  }
}

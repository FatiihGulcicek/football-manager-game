import { Injectable } from '@nestjs/common';

export type RefreshRateLimitInput = {
  ipHash?: string;
  sessionId?: string;
};

@Injectable()
export class RefreshRateLimitService {
  async consumeRefreshAttempt(_input: RefreshRateLimitInput): Promise<void> {
    // Sprint 4F will attach the Redis-backed refresh limiter at this boundary.
  }
}

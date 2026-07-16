import { Injectable } from '@nestjs/common';
import { LoginContext } from '@football-manager/database';

export type LoginRateLimitInput = {
  email: string;
  context: LoginContext;
};

@Injectable()
export class LoginRateLimitService {
  async consumeLoginAttempt(_input: LoginRateLimitInput): Promise<void> {
    // Sprint 4F will attach Redis-backed and bounded fallback limiters here.
  }
}

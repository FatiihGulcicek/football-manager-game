import { Injectable } from '@nestjs/common';

export const EMAIL_VERIFICATION_DELIVERY_SERVICE = Symbol('EMAIL_VERIFICATION_DELIVERY_SERVICE');

export type SendVerificationEmailInput = {
  userId: string;
  email: string;
  rawToken: string;
  expiresAt: Date;
};

export interface EmailVerificationDeliveryService {
  sendVerificationEmail(input: SendVerificationEmailInput): Promise<void>;
}

@Injectable()
export class NoopEmailVerificationDeliveryService implements EmailVerificationDeliveryService {
  async sendVerificationEmail(_input: SendVerificationEmailInput): Promise<void> {
    // Real delivery provider integration belongs to Sprint 4F+; this stub never logs token or email.
  }
}

import { Injectable } from '@nestjs/common';

export const PASSWORD_RESET_DELIVERY_SERVICE = Symbol('PASSWORD_RESET_DELIVERY_SERVICE');

export type SendPasswordResetEmailInput = {
  userId: string;
  email: string;
  rawToken: string;
  expiresAt: Date;
};

export interface PasswordResetDeliveryService {
  sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<void>;
}

@Injectable()
export class NoopPasswordResetDeliveryService implements PasswordResetDeliveryService {
  async sendPasswordResetEmail(_input: SendPasswordResetEmailInput): Promise<void> {
    // Real provider or queue integration belongs to a later sprint; this stub never logs token or email.
  }
}

import { BadRequestException } from '@nestjs/common';

export const AUTH_EMAIL_VERIFICATION_INVALID_CODE = 'AUTH_EMAIL_VERIFICATION_INVALID';
export const AUTH_EMAIL_VERIFICATION_INVALID_MESSAGE =
  'Doğrulama bağlantısı geçersiz veya süresi dolmuş.';

export class AuthEmailVerificationInvalidException extends BadRequestException {
  constructor(requestId: string) {
    super({
      error: {
        code: AUTH_EMAIL_VERIFICATION_INVALID_CODE,
        message: AUTH_EMAIL_VERIFICATION_INVALID_MESSAGE,
        requestId
      }
    });
  }
}

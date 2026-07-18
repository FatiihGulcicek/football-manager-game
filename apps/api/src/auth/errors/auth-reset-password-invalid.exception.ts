import { BadRequestException } from '@nestjs/common';

export const AUTH_RESET_PASSWORD_INVALID_CODE = 'INVALID_OR_EXPIRED_RESET_TOKEN';
export const AUTH_RESET_PASSWORD_INVALID_MESSAGE =
  'Parola s\u0131f\u0131rlama ba\u011flant\u0131s\u0131 ge\u00e7ersiz veya s\u00fcresi dolmu\u015f.';

export class AuthResetPasswordInvalidException extends BadRequestException {
  constructor(requestId: string) {
    super({
      error: {
        code: AUTH_RESET_PASSWORD_INVALID_CODE,
        message: AUTH_RESET_PASSWORD_INVALID_MESSAGE,
        requestId
      }
    });
  }
}

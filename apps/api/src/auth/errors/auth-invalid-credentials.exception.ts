import { UnauthorizedException } from '@nestjs/common';

export const AUTH_INVALID_CREDENTIALS_CODE = 'AUTH_INVALID_CREDENTIALS';
export const AUTH_INVALID_CREDENTIALS_MESSAGE = 'E-posta veya şifre hatalı.';

export class AuthInvalidCredentialsException extends UnauthorizedException {
  constructor(requestId: string) {
    super({
      error: {
        code: AUTH_INVALID_CREDENTIALS_CODE,
        message: AUTH_INVALID_CREDENTIALS_MESSAGE,
        requestId
      }
    });
  }
}

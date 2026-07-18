import { UnauthorizedException } from '@nestjs/common';

export const AUTH_UNAUTHORIZED_CODE = 'AUTH_UNAUTHORIZED';
export const AUTH_UNAUTHORIZED_MESSAGE = 'Oturum geçersiz veya süresi dolmuş.';

export class AuthUnauthorizedException extends UnauthorizedException {
  constructor(requestId: string) {
    super({
      error: {
        code: AUTH_UNAUTHORIZED_CODE,
        message: AUTH_UNAUTHORIZED_MESSAGE,
        requestId
      }
    });
  }
}

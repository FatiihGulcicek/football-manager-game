import { BadRequestException } from '@nestjs/common';

export const AUTH_LOGOUT_ALL_INVALID_BODY_CODE = 'AUTH_LOGOUT_ALL_INVALID_BODY';
export const AUTH_LOGOUT_ALL_INVALID_BODY_MESSAGE = 'Logout-all isteğinin gövdesi boş olmalıdır.';

export class AuthLogoutAllInvalidBodyException extends BadRequestException {
  constructor(requestId: string) {
    super({
      error: {
        code: AUTH_LOGOUT_ALL_INVALID_BODY_CODE,
        message: AUTH_LOGOUT_ALL_INVALID_BODY_MESSAGE,
        requestId
      }
    });
  }
}

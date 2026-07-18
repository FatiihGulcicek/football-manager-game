import { NotFoundException } from '@nestjs/common';

export const AUTH_SESSION_NOT_FOUND_CODE = 'AUTH_SESSION_NOT_FOUND';
export const AUTH_SESSION_NOT_FOUND_MESSAGE = 'Oturum bulunamadı.';

export class AuthSessionNotFoundException extends NotFoundException {
  constructor(requestId: string) {
    super({
      error: {
        code: AUTH_SESSION_NOT_FOUND_CODE,
        message: AUTH_SESSION_NOT_FOUND_MESSAGE,
        requestId
      }
    });
  }
}

import { BadRequestException } from '@nestjs/common';

export const AUTH_SESSION_REVOKE_INVALID_BODY_CODE = 'AUTH_SESSION_REVOKE_INVALID_BODY';
export const AUTH_SESSION_REVOKE_INVALID_BODY_MESSAGE = 'Session revoke isteğinin gövdesi boş olmalıdır.';

export class AuthSessionRevokeInvalidBodyException extends BadRequestException {
  constructor(requestId: string) {
    super({
      error: {
        code: AUTH_SESSION_REVOKE_INVALID_BODY_CODE,
        message: AUTH_SESSION_REVOKE_INVALID_BODY_MESSAGE,
        requestId
      }
    });
  }
}

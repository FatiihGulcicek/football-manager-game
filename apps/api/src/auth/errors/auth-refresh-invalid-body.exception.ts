import { BadRequestException } from '@nestjs/common';
import { createRefreshErrorBody } from './auth-refresh.exception';

export const AUTH_REFRESH_INVALID_BODY_CODE = 'AUTH_REFRESH_INVALID_BODY';
export const AUTH_REFRESH_INVALID_BODY_MESSAGE = 'Refresh isteğinin gövdesi boş olmalıdır.';

export class AuthRefreshInvalidBodyException extends BadRequestException {
  constructor(requestId: string) {
    super(createRefreshErrorBody(AUTH_REFRESH_INVALID_BODY_CODE, AUTH_REFRESH_INVALID_BODY_MESSAGE, requestId));
  }
}

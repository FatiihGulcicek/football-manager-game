import { ConflictException, UnauthorizedException } from '@nestjs/common';

export const AUTH_REFRESH_INVALID_CODE = 'AUTH_REFRESH_INVALID';
export const AUTH_REFRESH_INVALID_MESSAGE = 'Oturum yenilenemedi.';
export const AUTH_REFRESH_CONFLICT_CODE = 'AUTH_REFRESH_CONFLICT';
export const AUTH_REFRESH_CONFLICT_MESSAGE =
  'Oturum yenileme isteği çakıştı. Lütfen tekrar deneyin.';
export const AUTH_REFRESH_REUSED_CODE = 'AUTH_REFRESH_REUSED';
export const AUTH_REFRESH_REUSED_MESSAGE = 'Oturum yenilenemedi.';

type AuthRefreshErrorOptions = {
  clearRefreshCookie?: boolean;
};

export class AuthRefreshInvalidException extends UnauthorizedException {
  readonly clearRefreshCookie: boolean;

  constructor(requestId: string, options: AuthRefreshErrorOptions = {}) {
    super(createRefreshErrorBody(AUTH_REFRESH_INVALID_CODE, AUTH_REFRESH_INVALID_MESSAGE, requestId));
    this.clearRefreshCookie = options.clearRefreshCookie ?? false;
  }
}

export class AuthRefreshConflictException extends ConflictException {
  readonly clearRefreshCookie = false;

  constructor(requestId: string) {
    super(createRefreshErrorBody(AUTH_REFRESH_CONFLICT_CODE, AUTH_REFRESH_CONFLICT_MESSAGE, requestId));
  }
}

export class AuthRefreshReusedException extends UnauthorizedException {
  readonly clearRefreshCookie = true;

  constructor(requestId: string) {
    super(createRefreshErrorBody(AUTH_REFRESH_REUSED_CODE, AUTH_REFRESH_REUSED_MESSAGE, requestId));
  }
}

export type AuthRefreshException =
  | AuthRefreshInvalidException
  | AuthRefreshConflictException
  | AuthRefreshReusedException;

export function createRefreshErrorBody(code: string, message: string, requestId: string) {
  return {
    error: {
      code,
      message,
      requestId
    }
  };
}

import { HttpException, HttpStatus } from '@nestjs/common';

export const AUTH_RATE_LIMITED_CODE = 'AUTH_RATE_LIMITED';
export const AUTH_RATE_LIMITED_MESSAGE =
  'Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.';

export class AuthRateLimitExceededException extends HttpException {
  constructor(
    requestId: string,
    readonly retryAfterSeconds: number
  ) {
    super(
      {
        error: {
          code: AUTH_RATE_LIMITED_CODE,
          message: AUTH_RATE_LIMITED_MESSAGE,
          requestId
        }
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }
}

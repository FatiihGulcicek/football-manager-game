import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { AuthRateLimitExceededException } from '../errors/auth-rate-limit-exceeded.exception';

type HttpResponse = {
  setHeader: (name: string, value: string) => void;
  status: (statusCode: number) => {
    json: (body: unknown) => void;
  };
};

@Catch(AuthRateLimitExceededException)
export class AuthRateLimitExceptionFilter implements ExceptionFilter<AuthRateLimitExceededException> {
  catch(exception: AuthRateLimitExceededException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();

    response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}

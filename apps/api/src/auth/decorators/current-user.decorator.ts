import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedHttpRequest, AuthenticatedUser } from '../types/authenticated-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();

    return request.authenticatedUser;
  }
);

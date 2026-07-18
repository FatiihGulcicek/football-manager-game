import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { UserRole } from '@football-manager/database';
import { AuthUnauthorizedException } from '../errors/auth-unauthorized.exception';
import { createRequestId, readHeader } from '../http/auth-request.util';
import { AccessTokenService } from '../services/access-token.service';
import { SessionInactiveError, SessionService } from '../services/session.service';
import { AuthenticatedHttpRequest } from '../types/authenticated-user';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenService)
    private readonly accessTokenService: AccessTokenService,
    @Inject(SessionService)
    private readonly sessionService: SessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    const requestId = createRequestId(request);
    const accessToken = readBearerToken(request);

    if (!accessToken) {
      throw new AuthUnauthorizedException(requestId);
    }

    try {
      const verifiedToken = this.accessTokenService.verifyAccessToken(accessToken);

      await this.sessionService.assertSessionActive(verifiedToken.sessionId);

      const activeSession = await this.sessionService.getActiveSession(verifiedToken.sessionId);

      if (
        !activeSession ||
        activeSession.userId !== verifiedToken.userId ||
        activeSession.userRole !== verifiedToken.role ||
        !isUserRole(activeSession.userRole)
      ) {
        throw new AuthUnauthorizedException(requestId);
      }

      request.authenticatedUser = {
        userId: activeSession.userId,
        role: activeSession.userRole,
        sessionId: activeSession.id
      };

      return true;
    } catch (error) {
      if (error instanceof AuthUnauthorizedException) {
        throw error;
      }

      if (error instanceof SessionInactiveError) {
        throw new AuthUnauthorizedException(requestId);
      }

      throw new AuthUnauthorizedException(requestId);
    }
  }
}

function readBearerToken(request: AuthenticatedHttpRequest): string | undefined {
  const authorization = readHeader(request, 'authorization');

  if (!authorization) {
    return undefined;
  }

  const [scheme, token, unexpected] = authorization.trim().split(/\s+/);

  if (scheme.toLowerCase() !== 'bearer' || !token || unexpected) {
    return undefined;
  }

  return token;
}

function isUserRole(value: string): value is UserRole {
  return Object.values(UserRole).includes(value as UserRole);
}

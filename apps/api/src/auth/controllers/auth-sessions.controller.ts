import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from '@nestjs/common';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { resolveClientIp } from '../../http/client-ip.util';
import { clearRefreshCookie, RefreshCookieResponse } from '../cookies/refresh-cookie';
import { CurrentUser } from '../decorators/current-user.decorator';
import { SessionsResponseDto } from '../dto/session.dto';
import { AuthLogoutAllInvalidBodyException } from '../errors/auth-logout-all-invalid-body.exception';
import { AuthSessionRevokeInvalidBodyException } from '../errors/auth-session-revoke-invalid-body.exception';
import { AccessTokenGuard } from '../guards/access-token.guard';
import { createRequestId } from '../http/auth-request.util';
import {
  SessionManagementRequestContext,
  SessionManagementService
} from '../services/session-management.service';
import { AuthenticatedHttpRequest, AuthenticatedUser } from '../types/authenticated-user';

@Controller('auth')
@UseGuards(AccessTokenGuard)
export class AuthSessionsController {
  constructor(
    @Inject(SessionManagementService)
    private readonly sessionManagementService: SessionManagementService,
    @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig
  ) {}

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedHttpRequest,
    @Res({ passthrough: true }) response: RefreshCookieResponse
  ): Promise<void> {
    const requestId = createRequestId(request);

    assertEmptyLogoutAllBody(body, requestId);

    try {
      await this.sessionManagementService.logoutAll(user, createSessionRequestContext(request, this.config));
    } finally {
      clearRefreshCookie(response, this.config);
    }
  }

  @Get('sessions')
  async listSessions(@CurrentUser() user: AuthenticatedUser): Promise<SessionsResponseDto> {
    return this.sessionManagementService.listSessions(user);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedHttpRequest,
    @Res({ passthrough: true }) response: RefreshCookieResponse
  ): Promise<void> {
    const requestId = createRequestId(request);

    assertEmptySessionRevokeBody(body, requestId);

    const result = await this.sessionManagementService.revokeSession(
      user,
      sessionId,
      createSessionRequestContext(request, this.config)
    );

    if (result.isCurrent) {
      clearRefreshCookie(response, this.config);
    }
  }
}

function createSessionRequestContext(
  request: AuthenticatedHttpRequest,
  config: AuthConfig
): SessionManagementRequestContext {
  return {
    requestId: createRequestId(request),
    clientIp: resolveClientIp(request, config)
  };
}

function assertEmptyLogoutAllBody(body: unknown, requestId: string): void {
  if (isEmptyRequestBody(body)) {
    return;
  }

  throw new AuthLogoutAllInvalidBodyException(requestId);
}

function assertEmptySessionRevokeBody(body: unknown, requestId: string): void {
  if (isEmptyRequestBody(body)) {
    return;
  }

  throw new AuthSessionRevokeInvalidBodyException(requestId);
}

function isEmptyRequestBody(body: unknown): boolean {
  return (
    body === undefined ||
    body === null ||
    (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)
  );
}

import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { LoginContext } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { resolveClientIp } from '../../http/client-ip.util';
import {
  clearRefreshCookie,
  readCookie,
  RefreshCookieResponse,
  setRefreshCookie
} from '../cookies/refresh-cookie';
import { ForgotPasswordDto, ForgotPasswordResponseDto } from '../dto/forgot-password.dto';
import { LoginDto, LoginResponseDto } from '../dto/login.dto';
import { RefreshResponseDto } from '../dto/refresh.dto';
import { RegisterDto, RegisterResponseDto } from '../dto/register.dto';
import {
  ResendVerificationDto,
  ResendVerificationResponseDto
} from '../dto/resend-verification.dto';
import { VerifyEmailDto, VerifyEmailResponseDto } from '../dto/verify-email.dto';
import { AuthLogoutInvalidBodyException } from '../errors/auth-logout-invalid-body.exception';
import { AuthRefreshException } from '../errors/auth-refresh.exception';
import { AuthRefreshInvalidBodyException } from '../errors/auth-refresh-invalid-body.exception';
import {
  EmailVerificationResendService,
  ResendVerificationRequestContext
} from '../services/email-verification-resend.service';
import { EmailVerificationService } from '../services/email-verification.service';
import {
  ForgotPasswordRequestContext,
  ForgotPasswordService
} from '../services/forgot-password.service';
import { LoginRequestContext, LoginService } from '../services/login.service';
import { LogoutRequestContext, LogoutService } from '../services/logout.service';
import { RefreshRequestContext, RefreshService } from '../services/refresh.service';
import { RegisterService } from '../services/register.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(RegisterService) private readonly registerService: RegisterService,
    @Inject(EmailVerificationService)
    private readonly emailVerificationService: EmailVerificationService,
    @Inject(EmailVerificationResendService)
    private readonly emailVerificationResendService: EmailVerificationResendService,
    @Inject(ForgotPasswordService)
    private readonly forgotPasswordService: ForgotPasswordService,
    @Inject(LoginService) private readonly loginService: LoginService,
    @Inject(RefreshService) private readonly refreshService: RefreshService,
    @Inject(LogoutService) private readonly logoutService: LogoutService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.registerService.register(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() request: AuthHttpRequest
  ): Promise<VerifyEmailResponseDto> {
    return this.emailVerificationService.verifyEmail(dto, {
      requestId: readHeader(request, 'x-request-id')
    });
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Body() dto: ResendVerificationDto,
    @Req() request: AuthHttpRequest
  ): Promise<ResendVerificationResponseDto> {
    return this.emailVerificationResendService.resendVerification(
      dto,
      createResendVerificationRequestContext(request, this.config)
    );
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: AuthHttpRequest
  ): Promise<ForgotPasswordResponseDto> {
    return this.forgotPasswordService.forgotPassword(
      dto,
      createForgotPasswordRequestContext(request, this.config)
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: RefreshCookieResponse
  ): Promise<LoginResponseDto> {
    const loginResult = await this.loginService.login(
      dto,
      createLoginRequestContext(request, dto.context, this.config)
    );

    setRefreshCookie(response, this.config, loginResult.refreshCookie.value);

    return loginResult.response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: unknown,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: RefreshCookieResponse
  ): Promise<RefreshResponseDto> {
    assertEmptyRefreshBody(body, createRequestId(request));

    try {
      const result = await this.refreshService.refresh(
        readCookie(readHeader(request, 'cookie'), this.config.cookieName),
        createRefreshRequestContext(request, this.config)
      );

      setRefreshCookie(response, this.config, result.refreshCookie.value);

      return result.response;
    } catch (error) {
      if (isAuthRefreshException(error) && error.clearRefreshCookie) {
        clearRefreshCookie(response, this.config);
      }

      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() body: unknown,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: RefreshCookieResponse
  ): Promise<void> {
    assertEmptyLogoutBody(body, createRequestId(request));

    try {
      await this.logoutService.logout(
        readCookie(readHeader(request, 'cookie'), this.config.cookieName),
        createLogoutRequestContext(request, this.config)
      );
    } finally {
      clearRefreshCookie(response, this.config);
    }
  }
}

type AuthHttpRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
  ip?: string;
};

function createLoginRequestContext(
  request: AuthHttpRequest,
  context: LoginContext | undefined,
  config: AuthConfig
): LoginRequestContext {
  const userAgent = readHeader(request, 'user-agent');
  const operatingSystem = detectOperatingSystem(userAgent);
  const browser = detectBrowser(userAgent);
  const deviceType = detectDeviceType(userAgent);

  return {
    requestId: readHeader(request, 'x-request-id'),
    clientIp: resolveClientIp(request, config),
    userAgent,
    context: context ?? LoginContext.WEB,
    deviceName: createDeviceName(operatingSystem, browser),
    deviceType,
    browser,
    operatingSystem
  };
}

function createRefreshRequestContext(
  request: AuthHttpRequest,
  config: AuthConfig
): RefreshRequestContext {
  return {
    requestId: readHeader(request, 'x-request-id'),
    clientIp: resolveClientIp(request, config)
  };
}

function createResendVerificationRequestContext(
  request: AuthHttpRequest,
  config: AuthConfig
): ResendVerificationRequestContext {
  return {
    requestId: readHeader(request, 'x-request-id'),
    clientIp: resolveClientIp(request, config)
  };
}

function createForgotPasswordRequestContext(
  request: AuthHttpRequest,
  config: AuthConfig
): ForgotPasswordRequestContext {
  return {
    requestId: readHeader(request, 'x-request-id'),
    clientIp: resolveClientIp(request, config)
  };
}

function createLogoutRequestContext(
  request: AuthHttpRequest,
  config: AuthConfig
): LogoutRequestContext {
  return {
    requestId: readHeader(request, 'x-request-id'),
    clientIp: resolveClientIp(request, config)
  };
}

function assertEmptyRefreshBody(body: unknown, requestId: string): void {
  if (body === undefined || body === null) {
    return;
  }

  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) {
    return;
  }

  throw new AuthRefreshInvalidBodyException(requestId);
}

function assertEmptyLogoutBody(body: unknown, requestId: string): void {
  if (body === undefined || body === null) {
    return;
  }

  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) {
    return;
  }

  throw new AuthLogoutInvalidBodyException(requestId);
}

function isAuthRefreshException(error: unknown): error is AuthRefreshException {
  return (
    error instanceof Error &&
    'clearRefreshCookie' in error &&
    typeof (error as AuthRefreshException).clearRefreshCookie === 'boolean'
  );
}

function readHeader(request: AuthHttpRequest, headerName: string): string | undefined {
  const value = request.headers[headerName.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function createRequestId(request: AuthHttpRequest): string {
  const requestId = readHeader(request, 'x-request-id') ?? randomUUID();
  const normalizedRequestId = requestId.trim();

  if (!normalizedRequestId || containsControlCharacter(normalizedRequestId)) {
    return 'invalid';
  }

  return Array.from(normalizedRequestId).slice(0, 128).join('');
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && ((codePoint >= 1 && codePoint <= 31) || codePoint === 127)) {
      return true;
    }
  }

  return false;
}

function detectDeviceType(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }

  if (/ipad|tablet/i.test(userAgent)) {
    return 'tablet';
  }

  if (/mobile|android|iphone/i.test(userAgent)) {
    return 'mobile';
  }

  return 'desktop';
}

function detectBrowser(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }

  if (/edg\//i.test(userAgent)) {
    return 'Edge';
  }

  if (/chrome\//i.test(userAgent)) {
    return 'Chrome';
  }

  if (/firefox\//i.test(userAgent)) {
    return 'Firefox';
  }

  if (/safari\//i.test(userAgent)) {
    return 'Safari';
  }

  return undefined;
}

function detectOperatingSystem(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }

  if (/windows/i.test(userAgent)) {
    return 'Windows';
  }

  if (/android/i.test(userAgent)) {
    return 'Android';
  }

  if (/iphone|ipad|ios/i.test(userAgent)) {
    return 'iOS';
  }

  if (/mac os|macintosh/i.test(userAgent)) {
    return 'macOS';
  }

  if (/linux/i.test(userAgent)) {
    return 'Linux';
  }

  return undefined;
}

function createDeviceName(
  operatingSystem: string | undefined,
  browser: string | undefined
): string | undefined {
  if (!operatingSystem && !browser) {
    return undefined;
  }

  return [operatingSystem, browser].filter(Boolean).join(' ');
}

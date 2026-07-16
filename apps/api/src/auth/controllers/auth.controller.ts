import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { LoginContext } from '@football-manager/database';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { resolveClientIp } from '../../http/client-ip.util';
import { LoginDto, LoginResponseDto } from '../dto/login.dto';
import { RegisterDto, RegisterResponseDto } from '../dto/register.dto';
import { LoginRequestContext, LoginService } from '../services/login.service';
import { RegisterService } from '../services/register.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(RegisterService) private readonly registerService: RegisterService,
    @Inject(LoginService) private readonly loginService: LoginService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.registerService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse
  ): Promise<LoginResponseDto> {
    const loginResult = await this.loginService.login(
      dto,
      createLoginRequestContext(request, dto.context, this.config)
    );

    response.cookie(this.config.cookieName, loginResult.refreshCookie.value, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      path: this.config.cookiePath,
      maxAge: this.config.refreshTokenTtlSeconds * 1000,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {})
    });

    return loginResult.response;
  }
}

type AuthHttpRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
  ip?: string;
};

type CookieResponse = {
  cookie: (name: string, value: string, options: RefreshCookieOptions) => void;
};

type RefreshCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: AuthConfig['cookieSameSite'];
  path: string;
  maxAge: number;
  domain?: string;
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

function readHeader(request: AuthHttpRequest, headerName: string): string | undefined {
  const value = request.headers[headerName.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
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

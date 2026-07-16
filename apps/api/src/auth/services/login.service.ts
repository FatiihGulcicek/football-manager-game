import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { LoginContext, Prisma } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { LoginDto, LoginResponseDto } from '../dto/login.dto';
import { AuthInvalidCredentialsException } from '../errors/auth-invalid-credentials.exception';
import { AccessTokenService } from './access-token.service';
import { LoginRateLimitService } from './login-rate-limit.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

export type LoginRequestContext = {
  requestId?: string;
  clientIp: string;
  userAgent?: string;
  context?: LoginContext;
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  operatingSystem?: string;
};

export type LoginResult = {
  response: LoginResponseDto;
  refreshCookie: {
    value: string;
    expiresAt: Date;
  };
};

type LoginUserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  managerProfile: {
    displayName: string;
  } | null;
};

type NormalizedLoginInput = {
  email: string;
  password: string;
  context: LoginContext;
  requestId: string;
  clientIp: string;
  userAgent?: string;
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  operatingSystem?: string;
  emailHash: string;
  ipHash: string;
  userAgentHash?: string;
};

type LoginFailureReason = 'USER_NOT_FOUND' | 'INVALID_PASSWORD' | 'USER_DISABLED' | 'EMAIL_NOT_VERIFIED';

const LOGIN_DTO_FIELDS = new Set(['email', 'password', 'context']);

@Injectable()
export class LoginService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(PasswordService)
    private readonly passwordService: PasswordService,
    @Inject(SessionService)
    private readonly sessionService: SessionService,
    @Inject(RefreshTokenService)
    private readonly refreshTokenService: RefreshTokenService,
    @Inject(AccessTokenService)
    private readonly accessTokenService: AccessTokenService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService,
    @Inject(LoginRateLimitService)
    private readonly rateLimitService: LoginRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async login(dto: LoginDto, requestContext: LoginRequestContext): Promise<LoginResult> {
    const input = this.normalizeInput(dto, requestContext);
    await this.rateLimitService.consumeLoginAttempt({
      email: input.email,
      context: input.context
    });

    const user = await this.findUser(input.email);
    const passwordMatches = user
      ? await this.passwordService.verifyPassword(user.passwordHash, input.password)
      : await this.passwordService.verifyAgainstDummy(input.password);
    const failureReason = this.getFailureReason(user, passwordMatches);

    if (failureReason) {
      await this.recordFailure(input, user?.id ?? null, failureReason);
      throw new AuthInvalidCredentialsException(input.requestId);
    }

    if (!user) {
      throw new Error('Login user missing after successful validation');
    }

    return this.createSuccessfulLogin(input, user);
  }

  private async findUser(email: string): Promise<LoginUserRecord | null> {
    return this.prisma.user.findUnique({
      where: {
        email
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        isActive: true,
        emailVerifiedAt: true,
        managerProfile: {
          select: {
            displayName: true
          }
        }
      }
    });
  }

  private getFailureReason(
    user: LoginUserRecord | null,
    passwordMatches: boolean
  ): LoginFailureReason | null {
    if (!user) {
      return 'USER_NOT_FOUND';
    }

    if (!passwordMatches) {
      return 'INVALID_PASSWORD';
    }

    if (!user.isActive) {
      return 'USER_DISABLED';
    }

    if (!user.emailVerifiedAt) {
      return 'EMAIL_NOT_VERIFIED';
    }

    return null;
  }

  private async createSuccessfulLogin(
    input: NormalizedLoginInput,
    user: LoginUserRecord
  ): Promise<LoginResult> {
    const now = new Date();
    const refreshTokenExpiresAt = new Date(now.getTime() + this.config.refreshTokenTtlSeconds * 1000);
    let result: LoginResult | undefined;

    await this.prisma.$transaction(async (transaction) => {
      const session = await this.sessionService.createSession(
        {
          userId: user.id,
          tokenFamilyId: randomUUID(),
          deviceName: input.deviceName,
          deviceType: input.deviceType,
          browser: input.browser,
          operatingSystem: input.operatingSystem,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          expiresAt: refreshTokenExpiresAt
        },
        transaction
      );
      const refreshToken = await this.refreshTokenService.issueInitialToken(
        session.id,
        refreshTokenExpiresAt,
        transaction
      );
      const accessToken = this.accessTokenService.signAccessToken({
        userId: user.id,
        role: user.role,
        sessionId: session.id
      });

      await transaction.user.update({
        where: {
          id: user.id
        },
        data: {
          lastLoginAt: now
        }
      });
      await transaction.loginAttempt.create({
        data: {
          userId: user.id,
          emailHash: input.emailHash,
          success: true,
          failureReason: null,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          context: input.context
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: user.id,
          targetUserId: user.id,
          action: AUTH_AUDIT_EVENTS.LOGIN_SUCCEEDED,
          entityType: 'User',
          entityId: user.id,
          metadata: this.createAuditMetadata(input),
          ipHash: input.ipHash
        }
      });

      result = {
        response: {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: this.config.accessTokenTtlSeconds,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            managerProfile: user.managerProfile
          }
        },
        refreshCookie: {
          value: refreshToken.token,
          expiresAt: refreshTokenExpiresAt
        }
      };
    });

    if (!result) {
      throw new Error('Login transaction did not produce a result');
    }

    return result;
  }

  private async recordFailure(
    input: NormalizedLoginInput,
    userId: string | null,
    failureReason: LoginFailureReason
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.loginAttempt.create({
        data: {
          userId,
          emailHash: input.emailHash,
          success: false,
          failureReason,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          context: input.context
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: null,
          targetUserId: userId,
          action: AUTH_AUDIT_EVENTS.LOGIN_FAILED,
          entityType: userId ? 'User' : null,
          entityId: userId,
          metadata: this.createAuditMetadata(input),
          ipHash: input.ipHash
        }
      });
    });
  }

  private normalizeInput(dto: LoginDto, requestContext: LoginRequestContext): NormalizedLoginInput {
    this.assertAllowedFields(dto);

    const email = this.normalizeEmail(dto.email);
    const password = this.normalizePassword(dto.password);
    const context = dto.context ?? requestContext.context ?? LoginContext.WEB;
    const clientIp = this.normalizeContextText(requestContext.clientIp || 'unknown', 128);
    const userAgent = requestContext.userAgent
      ? this.normalizeContextText(requestContext.userAgent, 512)
      : undefined;

    return {
      email,
      password,
      context,
      requestId: this.normalizeContextText(requestContext.requestId ?? randomUUID(), 128),
      clientIp,
      userAgent,
      deviceName: normalizeOptionalContextField(requestContext.deviceName, 80),
      deviceType: normalizeOptionalContextField(requestContext.deviceType, 40),
      browser: normalizeOptionalContextField(requestContext.browser, 40),
      operatingSystem: normalizeOptionalContextField(requestContext.operatingSystem, 40),
      emailHash: this.hashContextValue('email', email),
      ipHash: this.hashContextValue('ip', clientIp),
      userAgentHash: userAgent ? this.hashContextValue('user-agent', userAgent) : undefined
    };
  }

  private normalizeEmail(email: string): string {
    const normalizedEmail = this.assertSafeText(email.trim().toLowerCase(), 'email');

    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new BadRequestException('Invalid email');
    }

    return normalizedEmail;
  }

  private normalizePassword(password: string): string {
    const normalizedPassword = this.assertSafeText(password.normalize('NFC'), 'password');

    if (Array.from(normalizedPassword).length > 128) {
      throw new BadRequestException('Invalid password');
    }

    return normalizedPassword;
  }

  private assertAllowedFields(dto: LoginDto): void {
    for (const fieldName of Object.keys(dto as unknown as Record<string, unknown>)) {
      if (!LOGIN_DTO_FIELDS.has(fieldName)) {
        throw new BadRequestException('Unsupported login field');
      }
    }
  }

  private normalizeContextText(value: string, maxLength: number): string {
    const normalizedValue = this.assertSafeText(value.trim(), 'request context');

    if (Array.from(normalizedValue).length > maxLength) {
      return Array.from(normalizedValue).slice(0, maxLength).join('');
    }

    return normalizedValue;
  }

  private assertSafeText(value: string, fieldName: string): string {
    if (value.includes('\0') || containsControlCharacter(value)) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }

    return value;
  }

  private hashContextValue(kind: string, value: string): string {
    return this.tokenHashService.hashToken(`${kind}:${value}`);
  }

  private createAuditMetadata(input: NormalizedLoginInput): Prisma.InputJsonObject {
    return {
      context: input.context,
      ...(input.deviceType ? { deviceType: input.deviceType } : {}),
      ...(input.browser ? { browser: input.browser } : {}),
      ...(input.operatingSystem ? { operatingSystem: input.operatingSystem } : {})
    };
  }
}

function normalizeOptionalContextField(value: string | undefined, maxLength: number): string | undefined {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return undefined;
  }

  return Array.from(normalizedValue).slice(0, maxLength).join('');
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

import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma, UserRole } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import {
  REGISTER_ACCEPTED_RESPONSE,
  RegisterDto,
  RegisterResponseDto
} from '../dto/register.dto';
import { PasswordService, PasswordValidationError } from './password.service';
import { RegisterRateLimitService } from './register-rate-limit.service';
import { TokenHashService } from './token-hash.service';
import { normalizeAuthEmail } from '../utils/email-normalization';

type NormalizedRegisterInput = {
  email: string;
  password: string;
  displayName: string;
  locale: string;
  timezone: string;
  context: 'WEB';
  requestId: string;
  clientIp: string;
};

export type RegisterRequestContext = {
  requestId?: string;
  clientIp?: string;
};

const REGISTER_DTO_FIELDS = new Set(['email', 'password', 'displayName', 'locale', 'timezone']);

@Injectable()
export class RegisterService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(PasswordService)
    private readonly passwordService: PasswordService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService,
    @Inject(RegisterRateLimitService)
    private readonly rateLimitService: RegisterRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async register(
    dto: RegisterDto,
    requestContext: RegisterRequestContext = {}
  ): Promise<RegisterResponseDto> {
    const input = this.normalizeInput(dto, requestContext);
    await this.rateLimitService.consumeRegisterAttempt({
      email: input.email,
      clientIp: input.clientIp,
      requestId: input.requestId
    });

    const passwordHash = await this.hashPassword(input.password);
    const verificationToken = this.tokenHashService.generateOpaqueToken();
    const verificationTokenHash = this.tokenHashService.hashToken(verificationToken);
    const now = new Date();
    const verificationExpiresAt = new Date(
      now.getTime() + this.config.emailVerifyTtlSeconds * 1000
    );

    try {
      await this.prisma.$transaction(async (transaction) => {
        await this.createRegistration(transaction, {
          input,
          passwordHash,
          verificationTokenHash,
          verificationExpiresAt,
          now
        });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }

    return REGISTER_ACCEPTED_RESPONSE;
  }

  private async createRegistration(
    transaction: Prisma.TransactionClient,
    data: {
      input: NormalizedRegisterInput;
      passwordHash: string;
      verificationTokenHash: string;
      verificationExpiresAt: Date;
      now: Date;
    }
  ): Promise<void> {
    const existingUser = await transaction.user.findUnique({
      where: {
        email: data.input.email
      },
      select: {
        id: true
      }
    });

    if (existingUser) {
      return;
    }

    const user = await transaction.user.create({
      data: {
        email: data.input.email,
        passwordHash: data.passwordHash,
        role: UserRole.USER,
        isActive: true,
        emailVerifiedAt: null
      },
      select: {
        id: true
      }
    });

    await transaction.managerProfile.create({
      data: {
        userId: user.id,
        displayName: data.input.displayName,
        locale: data.input.locale,
        timezone: data.input.timezone
      }
    });

    await transaction.emailVerificationToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        revokedAt: null
      },
      data: {
        revokedAt: data.now
      }
    });

    await transaction.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: data.verificationTokenHash,
        expiresAt: data.verificationExpiresAt,
        usedAt: null,
        revokedAt: null
      }
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: user.id,
        targetUserId: user.id,
        action: AUTH_AUDIT_EVENTS.REGISTERED,
        entityType: 'User',
        entityId: user.id,
        metadata: {
          context: data.input.context,
          locale: data.input.locale,
          timezone: data.input.timezone
        }
      }
    });
  }

  private normalizeInput(
    dto: RegisterDto,
    requestContext: RegisterRequestContext
  ): NormalizedRegisterInput {
    this.assertAllowedFields(dto);

    return {
      email: this.normalizeEmail(dto.email),
      password: dto.password,
      displayName: this.normalizeDisplayName(dto.displayName),
      locale: this.normalizeOptionalText(dto.locale, 'tr-TR', 20),
      timezone: this.normalizeOptionalText(dto.timezone, 'Europe/Istanbul', 64),
      context: 'WEB',
      requestId: this.normalizeContextText(requestContext.requestId ?? randomUUID(), 128),
      clientIp: this.normalizeContextText(requestContext.clientIp || 'unknown', 128)
    };
  }

  private normalizeEmail(email: string): string {
    return normalizeAuthEmail(email);
  }

  private assertAllowedFields(dto: RegisterDto): void {
    for (const fieldName of Object.keys(dto as unknown as Record<string, unknown>)) {
      if (!REGISTER_DTO_FIELDS.has(fieldName)) {
        throw new BadRequestException('Unsupported register field');
      }
    }
  }

  private normalizeDisplayName(displayName: string): string {
    const normalizedDisplayName = this.assertSafeText(displayName.trim(), 'displayName');
    const length = Array.from(normalizedDisplayName).length;

    if (length < 2 || length > 40) {
      throw new BadRequestException('Invalid displayName');
    }

    return normalizedDisplayName;
  }

  private normalizeOptionalText(value: string | undefined, fallback: string, maxLength: number): string {
    const normalizedValue = value?.trim() || fallback;
    const safeValue = this.assertSafeText(normalizedValue, 'optionalText');

    if (Array.from(safeValue).length > maxLength) {
      throw new BadRequestException('Invalid optional text');
    }

    return safeValue;
  }

  private assertSafeText(value: string, fieldName: string): string {
    if (value.includes('\0') || containsControlCharacter(value)) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }

    return value;
  }

  private normalizeContextText(value: string, maxLength: number): string {
    const normalizedValue = value.trim();

    if (normalizedValue.includes('\0') || containsControlCharacter(normalizedValue)) {
      return 'invalid';
    }

    return Array.from(normalizedValue).slice(0, maxLength).join('') || 'unknown';
  }

  private async hashPassword(password: string): Promise<string> {
    try {
      return await this.passwordService.hashPassword(password);
    } catch (error) {
      if (error instanceof PasswordValidationError) {
        throw new BadRequestException('Invalid password');
      }

      throw error;
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
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

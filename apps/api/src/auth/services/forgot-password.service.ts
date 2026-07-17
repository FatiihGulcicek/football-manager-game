import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import {
  FORGOT_PASSWORD_ACCEPTED_RESPONSE,
  ForgotPasswordDto,
  ForgotPasswordResponseDto
} from '../dto/forgot-password.dto';
import {
  PASSWORD_RESET_DELIVERY_SERVICE,
  PasswordResetDeliveryService,
  SendPasswordResetEmailInput
} from './password-reset-delivery.service';
import { PasswordResetRateLimitService } from './password-reset-rate-limit.service';
import { TokenHashService } from './token-hash.service';
import { lockAuthUserTransaction } from '../utils/advisory-lock';
import { normalizeAuthEmail } from '../utils/email-normalization';

export type ForgotPasswordRequestContext = {
  requestId?: string;
  clientIp?: string;
};

type NormalizedForgotPasswordInput = {
  email: string;
  emailHash: string;
  clientIp: string;
  requestId: string;
  requestedIpHash: string;
};

type StoredPasswordResetUser = {
  id: string;
  email: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
};

const FORGOT_PASSWORD_DTO_FIELDS = new Set(['email']);
const PASSWORD_RESET_LOCK_PREFIX = 'auth-password-reset';

@Injectable()
export class ForgotPasswordService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService,
    @Inject(PasswordResetRateLimitService)
    private readonly rateLimitService: PasswordResetRateLimitService,
    @Inject(PASSWORD_RESET_DELIVERY_SERVICE)
    private readonly deliveryService: PasswordResetDeliveryService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async forgotPassword(
    dto: ForgotPasswordDto,
    requestContext: ForgotPasswordRequestContext,
    now = new Date()
  ): Promise<ForgotPasswordResponseDto> {
    const input = this.normalizeInput(dto, requestContext);

    await this.rateLimitService.consumeForgotPasswordAttempt({
      emailHash: input.emailHash,
      clientIp: input.clientIp,
      requestId: input.requestId
    });

    const candidateUser = await this.prisma.user.findUnique({
      where: {
        email: input.email
      },
      select: {
        id: true
      }
    });

    if (!candidateUser) {
      return FORGOT_PASSWORD_ACCEPTED_RESPONSE;
    }

    const deliveryInput = await this.createResetTokenSafely(candidateUser.id, input, now);

    if (deliveryInput) {
      await this.deliverSafely(deliveryInput);
    }

    return FORGOT_PASSWORD_ACCEPTED_RESPONSE;
  }

  private async createResetTokenSafely(
    userId: string,
    input: NormalizedForgotPasswordInput,
    now: Date
  ): Promise<SendPasswordResetEmailInput | null> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockAuthUserTransaction(transaction, PASSWORD_RESET_LOCK_PREFIX, userId);

        const user = await this.findUserForReset(transaction, userId);

        if (!this.isEligibleUser(user, input.email)) {
          return null;
        }

        return this.rotatePasswordResetToken(transaction, user, input, now);
      });
    } catch {
      return null;
    }
  }

  private async rotatePasswordResetToken(
    transaction: Prisma.TransactionClient,
    user: StoredPasswordResetUser,
    input: NormalizedForgotPasswordInput,
    now: Date
  ): Promise<SendPasswordResetEmailInput> {
    const rawToken = this.tokenHashService.generateOpaqueToken();
    const tokenHash = this.tokenHashService.hashToken(rawToken);
    const expiresAt = new Date(now.getTime() + this.config.passwordResetTtlSeconds * 1000);

    await transaction.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        revokedAt: null
      },
      data: {
        revokedAt: now
      }
    });

    await transaction.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        usedAt: null,
        revokedAt: null,
        requestedIpHash: input.requestedIpHash
      }
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: user.id,
        targetUserId: user.id,
        action: AUTH_AUDIT_EVENTS.PASSWORD_RESET_REQUESTED,
        entityType: 'User',
        entityId: user.id,
        metadata: this.createAuditMetadata()
      }
    });

    return {
      userId: user.id,
      email: user.email,
      rawToken,
      expiresAt
    };
  }

  private findUserForReset(
    transaction: Prisma.TransactionClient,
    userId: string
  ): Promise<StoredPasswordResetUser | null> {
    return transaction.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true,
        email: true,
        isActive: true,
        emailVerifiedAt: true
      }
    });
  }

  private isEligibleUser(
    user: StoredPasswordResetUser | null,
    normalizedEmail: string
  ): user is StoredPasswordResetUser {
    return (
      user !== null &&
      user.isActive &&
      user.emailVerifiedAt !== null &&
      user.email === normalizedEmail
    );
  }

  private async deliverSafely(input: SendPasswordResetEmailInput): Promise<void> {
    try {
      await this.deliveryService.sendPasswordResetEmail(input);
    } catch {
      // The endpoint stays enumeration-safe. Provider retry/metrics belong to the delivery sprint.
    }
  }

  private normalizeInput(
    dto: ForgotPasswordDto,
    requestContext: ForgotPasswordRequestContext
  ): NormalizedForgotPasswordInput {
    this.assertAllowedFields(dto);

    if (typeof dto.email !== 'string') {
      throw new BadRequestException('Invalid email');
    }

    const email = normalizeAuthEmail(dto.email);
    const requestId = normalizeContextText(requestContext.requestId ?? randomUUID(), 128);
    const clientIp = normalizeContextText(requestContext.clientIp || 'unknown', 128);

    return {
      email,
      emailHash: this.tokenHashService.hashToken(`password-reset-email:${email}`),
      clientIp,
      requestId,
      requestedIpHash: this.tokenHashService.hashToken(`ip:${clientIp}`)
    };
  }

  private assertAllowedFields(dto: ForgotPasswordDto): void {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('Invalid forgot password body');
    }

    for (const fieldName of Object.keys(dto as unknown as Record<string, unknown>)) {
      if (!FORGOT_PASSWORD_DTO_FIELDS.has(fieldName)) {
        throw new BadRequestException('Unsupported forgot password field');
      }
    }
  }

  private createAuditMetadata(): Prisma.InputJsonObject {
    return {
      context: 'WEB',
      resetMethod: 'EMAIL_TOKEN'
    };
  }
}

function normalizeContextText(value: string, maxLength: number): string {
  const normalizedValue = value.trim();

  if (normalizedValue.includes('\0') || containsControlCharacter(normalizedValue)) {
    return 'invalid';
  }

  return Array.from(normalizedValue).slice(0, maxLength).join('') || 'unknown';
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

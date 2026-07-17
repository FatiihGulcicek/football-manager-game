import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import {
  RESEND_VERIFICATION_ACCEPTED_RESPONSE,
  ResendVerificationDto,
  ResendVerificationResponseDto
} from '../dto/resend-verification.dto';
import {
  EMAIL_VERIFICATION_DELIVERY_SERVICE,
  EmailVerificationDeliveryService,
  SendVerificationEmailInput
} from './email-verification-delivery.service';
import { EmailVerificationResendRateLimitService } from './email-verification-resend-rate-limit.service';
import { TokenHashService } from './token-hash.service';
import { normalizeAuthEmail } from '../utils/email-normalization';

export type ResendVerificationRequestContext = {
  requestId?: string;
  clientIp?: string;
};

type NormalizedResendVerificationInput = {
  email: string;
  emailHash: string;
  clientIp: string;
  requestId: string;
};

type StoredResendUser = {
  id: string;
  email: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
};

const RESEND_VERIFICATION_DTO_FIELDS = new Set(['email']);
const RESEND_LOCK_PREFIX = 'auth-email-resend';

@Injectable()
export class EmailVerificationResendService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService,
    @Inject(EmailVerificationResendRateLimitService)
    private readonly rateLimitService: EmailVerificationResendRateLimitService,
    @Inject(EMAIL_VERIFICATION_DELIVERY_SERVICE)
    private readonly deliveryService: EmailVerificationDeliveryService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async resendVerification(
    dto: ResendVerificationDto,
    requestContext: ResendVerificationRequestContext,
    now = new Date()
  ): Promise<ResendVerificationResponseDto> {
    const input = this.normalizeInput(dto, requestContext);

    await this.rateLimitService.consumeResendVerificationAttempt({
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
      return RESEND_VERIFICATION_ACCEPTED_RESPONSE;
    }

    const deliveryInput = await this.prisma.$transaction(async (transaction) => {
      await this.lockUserForResend(transaction, candidateUser.id);

      const user = await this.findUserForResend(transaction, candidateUser.id);

      if (!this.isEligibleUser(user, input.email)) {
        return null;
      }

      return this.rotateVerificationToken(transaction, user, now);
    });

    if (deliveryInput) {
      await this.deliverSafely(deliveryInput);
    }

    return RESEND_VERIFICATION_ACCEPTED_RESPONSE;
  }

  private async rotateVerificationToken(
    transaction: Prisma.TransactionClient,
    user: StoredResendUser,
    now: Date
  ): Promise<SendVerificationEmailInput> {
    const rawToken = this.tokenHashService.generateOpaqueToken();
    const tokenHash = this.tokenHashService.hashToken(rawToken);
    const expiresAt = new Date(now.getTime() + this.config.emailVerifyTtlSeconds * 1000);

    await transaction.emailVerificationToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        revokedAt: null
      },
      data: {
        revokedAt: now
      }
    });

    await transaction.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        usedAt: null,
        revokedAt: null
      }
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: user.id,
        targetUserId: user.id,
        action: AUTH_AUDIT_EVENTS.EMAIL_VERIFICATION_RESENT,
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

  private async lockUserForResend(
    transaction: Prisma.TransactionClient,
    userId: string
  ): Promise<void> {
    const lockKey = `${RESEND_LOCK_PREFIX}:${userId}`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  }

  private findUserForResend(
    transaction: Prisma.TransactionClient,
    userId: string
  ): Promise<StoredResendUser | null> {
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

  private isEligibleUser(user: StoredResendUser | null, normalizedEmail: string): user is StoredResendUser {
    return (
      user !== null &&
      user.isActive &&
      user.emailVerifiedAt === null &&
      user.email === normalizedEmail
    );
  }

  private async deliverSafely(input: SendVerificationEmailInput): Promise<void> {
    try {
      await this.deliveryService.sendVerificationEmail(input);
    } catch {
      // The endpoint stays enumeration-safe. Provider retry/metrics belong to the delivery sprint.
    }
  }

  private normalizeInput(
    dto: ResendVerificationDto,
    requestContext: ResendVerificationRequestContext
  ): NormalizedResendVerificationInput {
    this.assertAllowedFields(dto);

    if (typeof dto.email !== 'string') {
      throw new BadRequestException('Invalid email');
    }

    const email = normalizeAuthEmail(dto.email);
    const requestId = normalizeContextText(requestContext.requestId ?? randomUUID(), 128);
    const clientIp = normalizeContextText(requestContext.clientIp || 'unknown', 128);

    return {
      email,
      emailHash: this.tokenHashService.hashToken(`resend-email:${email}`),
      clientIp,
      requestId
    };
  }

  private assertAllowedFields(dto: ResendVerificationDto): void {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('Invalid resend verification body');
    }

    for (const fieldName of Object.keys(dto as unknown as Record<string, unknown>)) {
      if (!RESEND_VERIFICATION_DTO_FIELDS.has(fieldName)) {
        throw new BadRequestException('Unsupported resend verification field');
      }
    }
  }

  private createAuditMetadata(): Prisma.InputJsonObject {
    return {
      context: 'WEB',
      verificationMethod: 'TOKEN_RESEND'
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

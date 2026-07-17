import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import {
  EMAIL_VERIFIED_RESPONSE,
  VerifyEmailDto,
  VerifyEmailResponseDto
} from '../dto/verify-email.dto';
import { AuthEmailVerificationInvalidException } from '../errors/auth-email-verification-invalid.exception';
import { EmailVerificationRateLimitService } from './email-verification-rate-limit.service';
import { TokenHashService } from './token-hash.service';

export type VerifyEmailRequestContext = {
  requestId?: string;
};

type NormalizedVerifyEmailInput = {
  tokenHash: string;
  requestId: string;
};

type StoredEmailVerificationToken = {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  user: {
    id: string;
    isActive: boolean;
  } | null;
};

const VERIFY_EMAIL_DTO_FIELDS = new Set(['token']);
const MIN_VERIFY_TOKEN_LENGTH = 32;
const MAX_VERIFY_TOKEN_LENGTH = 256;

@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService,
    @Inject(EmailVerificationRateLimitService)
    private readonly rateLimitService: EmailVerificationRateLimitService
  ) {}

  async verifyEmail(
    dto: VerifyEmailDto,
    requestContext: VerifyEmailRequestContext,
    now = new Date()
  ): Promise<VerifyEmailResponseDto> {
    const input = this.normalizeInput(dto, requestContext);

    await this.rateLimitService.consumeVerifyEmailAttempt({
      tokenHash: input.tokenHash
    });

    await this.prisma.$transaction(async (transaction) => {
      const verificationToken = await this.findVerificationToken(transaction, input.tokenHash);

      if (!this.isValidVerificationToken(verificationToken, now)) {
        throw new AuthEmailVerificationInvalidException(input.requestId);
      }

      const consumedToken = await transaction.emailVerificationToken.updateMany({
        where: {
          id: verificationToken.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: {
            gt: now
          }
        },
        data: {
          usedAt: now
        }
      });

      if (consumedToken.count !== 1) {
        throw new AuthEmailVerificationInvalidException(input.requestId);
      }

      await transaction.user.update({
        where: {
          id: verificationToken.userId
        },
        data: {
          emailVerifiedAt: now
        }
      });

      await transaction.emailVerificationToken.updateMany({
        where: {
          userId: verificationToken.userId,
          id: {
            not: verificationToken.id
          },
          usedAt: null,
          revokedAt: null
        },
        data: {
          revokedAt: now
        }
      });

      await transaction.auditLog.create({
        data: {
          actorUserId: verificationToken.userId,
          targetUserId: verificationToken.userId,
          action: AUTH_AUDIT_EVENTS.EMAIL_VERIFIED,
          entityType: 'User',
          entityId: verificationToken.userId,
          metadata: this.createAuditMetadata()
        }
      });
    });

    return EMAIL_VERIFIED_RESPONSE;
  }

  private findVerificationToken(
    transaction: Prisma.TransactionClient,
    tokenHash: string
  ): Promise<StoredEmailVerificationToken | null> {
    return transaction.emailVerificationToken.findUnique({
      where: {
        tokenHash
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            isActive: true
          }
        }
      }
    });
  }

  private isValidVerificationToken(
    verificationToken: StoredEmailVerificationToken | null,
    now: Date
  ): verificationToken is StoredEmailVerificationToken {
    return (
      verificationToken !== null &&
      verificationToken.usedAt === null &&
      verificationToken.revokedAt === null &&
      verificationToken.expiresAt > now &&
      verificationToken.user?.isActive === true
    );
  }

  private createAuditMetadata(): Prisma.InputJsonObject {
    return {
      context: 'WEB',
      verificationMethod: 'TOKEN'
    };
  }

  private normalizeInput(
    dto: VerifyEmailDto,
    requestContext: VerifyEmailRequestContext
  ): NormalizedVerifyEmailInput {
    const requestId = normalizeContextText(requestContext.requestId ?? randomUUID(), 128);
    const rawToken = this.normalizeToken(dto, requestId);

    return {
      tokenHash: this.tokenHashService.hashToken(rawToken),
      requestId
    };
  }

  private normalizeToken(dto: VerifyEmailDto, requestId: string): string {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new AuthEmailVerificationInvalidException(requestId);
    }

    for (const fieldName of Object.keys(dto as Record<string, unknown>)) {
      if (!VERIFY_EMAIL_DTO_FIELDS.has(fieldName)) {
        throw new AuthEmailVerificationInvalidException(requestId);
      }
    }

    if (typeof dto.token !== 'string') {
      throw new AuthEmailVerificationInvalidException(requestId);
    }

    const normalizedToken = dto.token.trim();
    const tokenLength = Array.from(normalizedToken).length;

    if (
      tokenLength < MIN_VERIFY_TOKEN_LENGTH ||
      tokenLength > MAX_VERIFY_TOKEN_LENGTH ||
      normalizedToken.includes('\0') ||
      containsControlCharacter(normalizedToken)
    ) {
      throw new AuthEmailVerificationInvalidException(requestId);
    }

    return normalizedToken;
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

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import {
  RESET_PASSWORD_SUCCESS_RESPONSE,
  ResetPasswordDto,
  ResetPasswordResponseDto
} from '../dto/reset-password.dto';
import { AuthResetPasswordInvalidException } from '../errors/auth-reset-password-invalid.exception';
import { lockAuthTransaction } from '../utils/advisory-lock';
import { PasswordResetRateLimitService } from './password-reset-rate-limit.service';
import { PasswordService, PasswordValidationError } from './password.service';
import { SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

export type ResetPasswordRequestContext = {
  requestId?: string;
  clientIp?: string;
};

type NormalizedResetPasswordInput = {
  token: string;
  tokenHash: string;
  newPassword: string;
  clientIp: string;
  requestId: string;
};

type StoredResetPasswordToken = {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  user: {
    id: string;
    isActive: boolean;
    emailVerifiedAt: Date | null;
  } | null;
};

type ResetPasswordTransactionResult = {
  revokedSessionIds: string[];
};

const RESET_PASSWORD_DTO_FIELDS = new Set(['token', 'newPassword']);
const RESET_PASSWORD_TOKEN_MIN_LENGTH = 32;
const RESET_PASSWORD_TOKEN_MAX_LENGTH = 512;
const RESET_PASSWORD_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const PASSWORD_RESET_CONSUME_LOCK_PREFIX = 'auth-password-reset-consume';
const PASSWORD_RESET_REVOKE_REASON = 'PASSWORD_RESET';

class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super('INVALID_PASSWORD_RESET_TOKEN');
    this.name = 'InvalidPasswordResetTokenError';
  }
}

@Injectable()
export class ResetPasswordService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService,
    @Inject(PasswordService)
    private readonly passwordService: PasswordService,
    @Inject(PasswordResetRateLimitService)
    private readonly rateLimitService: PasswordResetRateLimitService,
    @Inject(SessionService)
    private readonly sessionService: SessionService
  ) {}

  async resetPassword(
    dto: ResetPasswordDto,
    requestContext: ResetPasswordRequestContext,
    now = new Date()
  ): Promise<ResetPasswordResponseDto> {
    const input = this.normalizeInput(dto, requestContext);

    await this.rateLimitService.consumeResetPasswordAttempt({
      tokenHash: input.tokenHash,
      clientIp: input.clientIp,
      requestId: input.requestId
    });

    const candidateToken = await this.prisma.passwordResetToken.findUnique({
      where: {
        tokenHash: input.tokenHash
      },
      select: {
        id: true
      }
    });

    if (!candidateToken) {
      throw new AuthResetPasswordInvalidException(input.requestId);
    }

    const passwordHash = await this.hashPassword(input.newPassword);
    const result = await this.consumeTokenAndResetPassword(input, passwordHash, now);

    await this.sessionService.invalidateSessionCaches(result.revokedSessionIds);

    return RESET_PASSWORD_SUCCESS_RESPONSE;
  }

  private async consumeTokenAndResetPassword(
    input: NormalizedResetPasswordInput,
    passwordHash: string,
    now: Date
  ): Promise<ResetPasswordTransactionResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockAuthTransaction(transaction, PASSWORD_RESET_CONSUME_LOCK_PREFIX, input.tokenHash);

        const token = await this.findTokenForReset(transaction, input.tokenHash);

        if (!this.isValidToken(token, now)) {
          throw new InvalidPasswordResetTokenError();
        }

        const revokedSessionIds = await this.findRevokableSessionIds(transaction, token.userId);

        await transaction.user.update({
          where: {
            id: token.userId
          },
          data: {
            passwordHash
          }
        });

        const consumedToken = await transaction.passwordResetToken.updateMany({
          where: {
            id: token.id,
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
          throw new InvalidPasswordResetTokenError();
        }

        await transaction.passwordResetToken.updateMany({
          where: {
            userId: token.userId,
            id: {
              not: token.id
            },
            usedAt: null,
            revokedAt: null
          },
          data: {
            revokedAt: now
          }
        });

        if (revokedSessionIds.length > 0) {
          await transaction.userSession.updateMany({
            where: {
              id: {
                in: revokedSessionIds
              },
              revokedAt: null
            },
            data: {
              revokedAt: now,
              revokeReason: PASSWORD_RESET_REVOKE_REASON
            }
          });

          await transaction.refreshToken.updateMany({
            where: {
              sessionId: {
                in: revokedSessionIds
              },
              revokedAt: null
            },
            data: {
              revokedAt: now
            }
          });
        }

        await transaction.auditLog.create({
          data: {
            actorUserId: token.userId,
            targetUserId: token.userId,
            action: AUTH_AUDIT_EVENTS.PASSWORD_RESET_COMPLETED,
            entityType: 'User',
            entityId: token.userId,
            metadata: this.createAuditMetadata()
          }
        });

        return {
          revokedSessionIds
        };
      });
    } catch (error) {
      if (error instanceof InvalidPasswordResetTokenError) {
        throw new AuthResetPasswordInvalidException(input.requestId);
      }

      throw error;
    }
  }

  private findTokenForReset(
    transaction: Prisma.TransactionClient,
    tokenHash: string
  ): Promise<StoredResetPasswordToken | null> {
    return transaction.passwordResetToken.findUnique({
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
            isActive: true,
            emailVerifiedAt: true
          }
        }
      }
    });
  }

  private async findRevokableSessionIds(
    transaction: Prisma.TransactionClient,
    userId: string
  ): Promise<string[]> {
    const sessions = await transaction.userSession.findMany({
      where: {
        userId,
        revokedAt: null
      },
      select: {
        id: true
      }
    });

    return sessions.map((session) => session.id);
  }

  private isValidToken(
    token: StoredResetPasswordToken | null,
    now: Date
  ): token is StoredResetPasswordToken {
    return (
      token !== null &&
      token.user !== null &&
      token.user.isActive &&
      token.user.emailVerifiedAt !== null &&
      token.usedAt === null &&
      token.revokedAt === null &&
      token.expiresAt > now
    );
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

  private normalizeInput(
    dto: ResetPasswordDto,
    requestContext: ResetPasswordRequestContext
  ): NormalizedResetPasswordInput {
    this.assertAllowedFields(dto);

    if (typeof dto.token !== 'string' || !isValidResetTokenInput(dto.token)) {
      throw new BadRequestException('Invalid reset password body');
    }

    if (typeof dto.newPassword !== 'string') {
      throw new BadRequestException('Invalid reset password body');
    }

    const requestId = normalizeContextText(requestContext.requestId ?? randomUUID(), 128);
    const clientIp = normalizeContextText(requestContext.clientIp || 'unknown', 128);

    return {
      token: dto.token,
      tokenHash: this.tokenHashService.hashToken(dto.token),
      newPassword: dto.newPassword,
      clientIp,
      requestId
    };
  }

  private assertAllowedFields(dto: ResetPasswordDto): void {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('Invalid reset password body');
    }

    for (const fieldName of Object.keys(dto as unknown as Record<string, unknown>)) {
      if (!RESET_PASSWORD_DTO_FIELDS.has(fieldName)) {
        throw new BadRequestException('Unsupported reset password field');
      }
    }
  }

  private createAuditMetadata(): Prisma.InputJsonObject {
    return {
      context: 'WEB',
      resetMethod: 'EMAIL_TOKEN',
      sessionsRevoked: true
    };
  }
}

function isValidResetTokenInput(token: string): boolean {
  const length = Array.from(token).length;

  return (
    length >= RESET_PASSWORD_TOKEN_MIN_LENGTH &&
    length <= RESET_PASSWORD_TOKEN_MAX_LENGTH &&
    RESET_PASSWORD_TOKEN_PATTERN.test(token)
  );
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

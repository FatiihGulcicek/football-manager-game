import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { RefreshResponseDto } from '../dto/refresh.dto';
import {
  AuthRefreshConflictException,
  AuthRefreshInvalidException,
  AuthRefreshReusedException
} from '../errors/auth-refresh.exception';
import { AccessTokenService } from './access-token.service';
import { RefreshRateLimitService } from './refresh-rate-limit.service';
import { RefreshTokenService } from './refresh-token.service';
import { SessionInactiveError, SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

export type RefreshRequestContext = {
  requestId?: string;
  clientIp: string;
};

export type RefreshResult = {
  response: RefreshResponseDto;
  refreshCookie: {
    value: string;
    expiresAt: Date;
  };
};

type NormalizedRefreshInput = {
  requestId: string;
  clientIp: string;
  ipHash: string;
};

type StoredRefreshToken = {
  id: string;
  sessionId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    user: {
      id: string;
      role: string;
      isActive: boolean;
    };
  };
};

type ActiveSessionForRefresh = {
  id: string;
  userId: string;
  user: {
    role: string;
  };
};

@Injectable()
export class RefreshService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService,
    @Inject(SessionService)
    private readonly sessionService: SessionService,
    @Inject(RefreshTokenService)
    private readonly refreshTokenService: RefreshTokenService,
    @Inject(AccessTokenService)
    private readonly accessTokenService: AccessTokenService,
    @Inject(RefreshRateLimitService)
    private readonly rateLimitService: RefreshRateLimitService,
    @Optional() @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig = authConfig
  ) {}

  async refresh(
    refreshToken: string | undefined,
    requestContext: RefreshRequestContext,
    now = new Date()
  ): Promise<RefreshResult> {
    const input = this.normalizeInput(requestContext);
    await this.rateLimitService.consumeRefreshAttempt({
      ipHash: input.ipHash,
      requestId: input.requestId
    });

    if (!refreshToken) {
      await this.recordRefreshFailure(input, null, 'missing_cookie');
      throw new AuthRefreshInvalidException(input.requestId);
    }

    const currentToken = await this.findRefreshToken(this.tokenHashService.hashToken(refreshToken));

    if (!currentToken) {
      await this.recordRefreshFailure(input, null, 'invalid_token');
      throw new AuthRefreshInvalidException(input.requestId, { clearRefreshCookie: true });
    }

    await this.rateLimitService.consumeRefreshAttempt({
      ipHash: input.ipHash,
      sessionId: currentToken.sessionId,
      requestId: input.requestId
    });

    if (currentToken.usedAt) {
      await this.handleUsedToken(currentToken, input, now);
    }

    if (currentToken.revokedAt || currentToken.expiresAt <= now) {
      await this.recordRefreshFailure(input, currentToken, 'invalid_token');
      throw new AuthRefreshInvalidException(input.requestId, { clearRefreshCookie: true });
    }

    if (this.isInactiveSession(currentToken, now)) {
      await this.recordRefreshFailure(input, currentToken, 'inactive_session');
      throw new AuthRefreshInvalidException(input.requestId, { clearRefreshCookie: true });
    }

    try {
      await this.sessionService.assertSessionActive(currentToken.sessionId, now);
    } catch (error) {
      if (error instanceof SessionInactiveError) {
        await this.recordRefreshFailure(input, currentToken, 'inactive_session');
        throw new AuthRefreshInvalidException(input.requestId, { clearRefreshCookie: true });
      }

      throw error;
    }

    return this.rotateActiveToken(currentToken, input, now);
  }

  private async findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: {
        tokenHash
      },
      select: {
        id: true,
        sessionId: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        session: {
          select: {
            id: true,
            userId: true,
            expiresAt: true,
            revokedAt: true,
            user: {
              select: {
                id: true,
                role: true,
                isActive: true
              }
            }
          }
        }
      }
    });
  }

  private async handleUsedToken(
    currentToken: StoredRefreshToken,
    input: NormalizedRefreshInput,
    now: Date
  ): Promise<never> {
    if (currentToken.usedAt && this.isWithinGraceWindow(currentToken.usedAt, now)) {
      throw new AuthRefreshConflictException(input.requestId);
    }

    await this.refreshTokenService.revokeTokenFamily(currentToken.sessionId, now);
    await this.recordRefreshReuse(input, currentToken);
    throw new AuthRefreshReusedException(input.requestId);
  }

  private async rotateActiveToken(
    currentToken: StoredRefreshToken,
    input: NormalizedRefreshInput,
    now: Date
  ): Promise<RefreshResult> {
    let result: RefreshResult | undefined;

    await this.prisma.$transaction(async (transaction) => {
      const activeSession = await this.findActiveSessionInTransaction(
        transaction,
        currentToken.sessionId,
        now
      );

      if (!activeSession) {
        throw new AuthRefreshInvalidException(input.requestId, { clearRefreshCookie: true });
      }

      const accessToken = this.accessTokenService.signAccessToken({
        userId: activeSession.userId,
        role: activeSession.user.role,
        sessionId: activeSession.id
      });
      const nextToken = this.tokenHashService.generateOpaqueToken();
      const nextTokenHash = this.tokenHashService.hashToken(nextToken);
      const updatedToken = await transaction.refreshToken.updateMany({
        where: {
          id: currentToken.id,
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

      if (updatedToken.count !== 1) {
        throw new AuthRefreshConflictException(input.requestId);
      }

      await transaction.refreshToken.create({
        data: {
          sessionId: activeSession.id,
          parentTokenId: currentToken.id,
          tokenHash: nextTokenHash,
          expiresAt: currentToken.expiresAt
        }
      });
      await transaction.userSession.update({
        where: {
          id: activeSession.id
        },
        data: {
          lastSeenAt: now
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: activeSession.userId,
          targetUserId: activeSession.userId,
          action: AUTH_AUDIT_EVENTS.REFRESH_SUCCEEDED,
          entityType: 'UserSession',
          entityId: activeSession.id,
          metadata: this.createAuditMetadata('success', activeSession.id),
          ipHash: input.ipHash
        }
      });

      result = {
        response: {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: this.config.accessTokenTtlSeconds
        },
        refreshCookie: {
          value: nextToken,
          expiresAt: currentToken.expiresAt
        }
      };
    });

    if (!result) {
      throw new Error('Refresh transaction did not produce a result');
    }

    return result;
  }

  private findActiveSessionInTransaction(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    now: Date
  ): Promise<ActiveSessionForRefresh | null> {
    return transaction.userSession.findFirst({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: {
          gt: now
        },
        user: {
          isActive: true
        }
      },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            role: true
          }
        }
      }
    });
  }

  private async recordRefreshFailure(
    input: NormalizedRefreshInput,
    currentToken: StoredRefreshToken | null,
    reason: string
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: currentToken?.session.userId ?? null,
        targetUserId: currentToken?.session.userId ?? null,
        action: AUTH_AUDIT_EVENTS.REFRESH_FAILED,
        entityType: currentToken ? 'UserSession' : null,
        entityId: currentToken?.sessionId ?? null,
        metadata: this.createAuditMetadata(reason, currentToken?.sessionId),
        ipHash: input.ipHash
      }
    });
  }

  private async recordRefreshReuse(
    input: NormalizedRefreshInput,
    currentToken: StoredRefreshToken
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: currentToken.session.userId,
        targetUserId: currentToken.session.userId,
        action: AUTH_AUDIT_EVENTS.REFRESH_REUSED,
        entityType: 'UserSession',
        entityId: currentToken.sessionId,
        metadata: this.createAuditMetadata('reused', currentToken.sessionId),
        ipHash: input.ipHash
      }
    });
  }

  private createAuditMetadata(reason: string, sessionId?: string): Prisma.InputJsonObject {
    return {
      context: 'REFRESH',
      reason,
      ...(sessionId ? { sessionId } : {})
    };
  }

  private normalizeInput(requestContext: RefreshRequestContext): NormalizedRefreshInput {
    const requestId = this.normalizeContextText(requestContext.requestId ?? randomUUID(), 128);
    const clientIp = this.normalizeContextText(requestContext.clientIp || 'unknown', 128);

    return {
      requestId,
      clientIp,
      ipHash: this.tokenHashService.hashToken(`ip:${clientIp}`)
    };
  }

  private normalizeContextText(value: string, maxLength: number): string {
    const normalizedValue = value.trim();

    if (normalizedValue.includes('\0') || containsControlCharacter(normalizedValue)) {
      return 'invalid';
    }

    return Array.from(normalizedValue).slice(0, maxLength).join('') || 'unknown';
  }

  private isInactiveSession(currentToken: StoredRefreshToken, now: Date): boolean {
    return (
      currentToken.session.revokedAt !== null ||
      currentToken.session.expiresAt <= now ||
      !currentToken.session.user.isActive
    );
  }

  private isWithinGraceWindow(usedAt: Date, now: Date): boolean {
    const elapsedSeconds = Math.abs(now.getTime() - usedAt.getTime()) / 1000;
    return elapsedSeconds <= this.config.refreshGraceSeconds;
  }
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

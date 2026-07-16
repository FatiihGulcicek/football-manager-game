import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { authConfig, AuthConfig } from '../../config/auth.config';
import { SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

export class RefreshTokenInvalidError extends Error {
  constructor(message = 'AUTH_REFRESH_INVALID') {
    super(message);
    this.name = 'RefreshTokenInvalidError';
  }
}

export class RefreshTokenConflictError extends Error {
  constructor(message = 'AUTH_REFRESH_CONFLICT') {
    super(message);
    this.name = 'RefreshTokenConflictError';
  }
}

export class RefreshTokenReusedError extends Error {
  constructor(message = 'AUTH_REFRESH_REUSED') {
    super(message);
    this.name = 'RefreshTokenReusedError';
  }
}

export type IssuedRefreshToken = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenHashService: TokenHashService,
    private readonly sessionService: SessionService,
    private readonly config: AuthConfig = authConfig
  ) {}

  async issueInitialToken(sessionId: string, expiresAt: Date): Promise<IssuedRefreshToken> {
    const token = this.tokenHashService.generateOpaqueToken();
    const tokenHash = this.tokenHashService.hashToken(token);

    await this.prisma.refreshToken.create({
      data: {
        sessionId,
        tokenHash,
        expiresAt
      }
    });

    return {
      token,
      tokenHash,
      expiresAt
    };
  }

  async rotateToken(token: string, now = new Date()): Promise<IssuedRefreshToken> {
    const tokenHash = this.tokenHashService.hashToken(token);
    const currentToken = await this.prisma.refreshToken.findUnique({
      where: {
        tokenHash
      }
    });

    if (!currentToken) {
      throw new RefreshTokenInvalidError();
    }

    if (currentToken.usedAt) {
      if (this.isWithinGraceWindow(currentToken.usedAt, now)) {
        throw new RefreshTokenConflictError();
      }

      await this.revokeTokenFamily(currentToken.sessionId, now);
      throw new RefreshTokenReusedError();
    }

    if (currentToken.revokedAt || currentToken.expiresAt <= now) {
      throw new RefreshTokenInvalidError();
    }

    const nextToken = this.tokenHashService.generateOpaqueToken();
    const nextTokenHash = this.tokenHashService.hashToken(nextToken);

    await this.prisma.$transaction(async (transaction) => {
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
        throw new RefreshTokenConflictError();
      }

      await transaction.refreshToken.create({
        data: {
          sessionId: currentToken.sessionId,
          parentTokenId: currentToken.id,
          tokenHash: nextTokenHash,
          expiresAt: currentToken.expiresAt
        }
      });
    });

    return {
      token: nextToken,
      tokenHash: nextTokenHash,
      expiresAt: currentToken.expiresAt
    };
  }

  async revokeTokenFamily(sessionId: string, revokedAt = new Date()): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        sessionId,
        revokedAt: null
      },
      data: {
        revokedAt
      }
    });

    await this.sessionService.revokeSession(sessionId, 'refresh_reused', revokedAt);
  }

  private isWithinGraceWindow(usedAt: Date, now: Date): boolean {
    const elapsedSeconds = Math.abs(now.getTime() - usedAt.getTime()) / 1000;
    return elapsedSeconds <= this.config.refreshGraceSeconds;
  }
}

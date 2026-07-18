import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

export type LogoutRequestContext = {
  requestId?: string;
  clientIp?: string;
};

type LogoutRefreshToken = {
  sessionId: string;
  session: {
    id: string;
    userId: string;
    revokedAt: Date | null;
  } | null;
};

type NormalizedLogoutInput = {
  clientIp: string;
  ipHash: string;
};

@Injectable()
export class LogoutService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService,
    @Inject(SessionService)
    private readonly sessionService: SessionService
  ) {}

  async logout(refreshToken: string | undefined, requestContext: LogoutRequestContext, now = new Date()): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const currentToken = await this.findRefreshToken(this.tokenHashService.hashToken(refreshToken));

    if (!currentToken?.session || currentToken.session.revokedAt !== null) {
      return;
    }

    const input = this.normalizeInput(requestContext);
    await this.sessionService.revokeSession(currentToken.sessionId, 'user_logout', now);
    await this.recordLogout(input, currentToken);
  }

  private async findRefreshToken(tokenHash: string): Promise<LogoutRefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: {
        tokenHash
      },
      select: {
        sessionId: true,
        session: {
          select: {
            id: true,
            userId: true,
            revokedAt: true
          }
        }
      }
    });
  }

  private async recordLogout(input: NormalizedLogoutInput, currentToken: LogoutRefreshToken): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: currentToken.session?.userId ?? null,
          targetUserId: currentToken.session?.userId ?? null,
          action: AUTH_AUDIT_EVENTS.LOGOUT,
          entityType: 'UserSession',
          entityId: currentToken.sessionId,
          metadata: this.createAuditMetadata(currentToken.sessionId),
          ipHash: input.ipHash
        }
      });
    } catch {
      // The session revoke is the security outcome; audit storage must not re-open the session.
    }
  }

  private createAuditMetadata(sessionId: string): Prisma.InputJsonObject {
    return {
      context: 'LOGOUT',
      reason: 'user_logout',
      sessionId
    };
  }

  private normalizeInput(requestContext: LogoutRequestContext): NormalizedLogoutInput {
    const clientIp = this.normalizeContextText(requestContext.clientIp || 'unknown', 128);

    return {
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

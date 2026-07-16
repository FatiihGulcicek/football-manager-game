import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { SessionsResponseDto } from '../dto/session.dto';
import { AuthSessionNotFoundException } from '../errors/auth-session-not-found.exception';
import { AuthenticatedUser } from '../types/authenticated-user';
import { SessionService } from './session.service';
import { TokenHashService } from './token-hash.service';

export type SessionManagementRequestContext = {
  requestId: string;
  clientIp?: string;
};

@Injectable()
export class SessionManagementService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(SessionService)
    private readonly sessionService: SessionService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService
  ) {}

  async listSessions(user: AuthenticatedUser): Promise<SessionsResponseDto> {
    const sessions = await this.sessionService.listUserSessions(user.userId);

    return {
      sessions: sessions
        .map((session) => ({
          id: session.id,
          deviceName: session.deviceName,
          deviceType: normalizeDeviceType(session.deviceType),
          browser: session.browser,
          operatingSystem: session.operatingSystem,
          countryCode: session.countryCode,
          city: session.city,
          lastSeenAt: session.lastSeenAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          isCurrent: session.id === user.sessionId
        }))
        .sort((left, right) => sortCurrentSessionFirst(left, right))
    };
  }

  async logoutAll(user: AuthenticatedUser, context: SessionManagementRequestContext): Promise<void> {
    const sessionCount = await this.sessionService.revokeAllUserSessions(user.userId, 'user_logout_all');

    await this.recordAudit({
      actorUserId: user.userId,
      targetUserId: user.userId,
      action: AUTH_AUDIT_EVENTS.LOGOUT_ALL,
      entityType: 'User',
      entityId: user.userId,
      metadata: {
        sessionCount,
        reason: 'user_logout_all'
      },
      ipHash: this.hashClientIp(context.clientIp)
    });
  }

  async revokeSession(
    user: AuthenticatedUser,
    targetSessionId: string,
    context: SessionManagementRequestContext
  ): Promise<{ isCurrent: boolean }> {
    const revokeResult = await this.sessionService.revokeOwnedSession(
      user.userId,
      targetSessionId,
      'user_session_revoke'
    );

    if (!revokeResult) {
      throw new AuthSessionNotFoundException(context.requestId);
    }

    const isCurrent = targetSessionId === user.sessionId;

    await this.recordAudit({
      actorUserId: user.userId,
      targetUserId: user.userId,
      action: AUTH_AUDIT_EVENTS.SESSION_REVOKED,
      entityType: 'UserSession',
      entityId: targetSessionId,
      metadata: {
        targetSessionId,
        isCurrent,
        reason: 'user_session_revoke'
      },
      ipHash: this.hashClientIp(context.clientIp)
    });

    return { isCurrent };
  }

  private async recordAudit(data: {
    actorUserId: string;
    targetUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Prisma.InputJsonObject;
    ipHash: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data
      });
    } catch {
      // Revocation is the security outcome; audit storage must not re-open sessions.
    }
  }

  private hashClientIp(clientIp: string | undefined): string {
    const normalizedIp = normalizeContextText(clientIp ?? 'unknown', 128);

    return this.tokenHashService.hashToken(`ip:${normalizedIp}`);
  }
}

function sortCurrentSessionFirst(
  left: SessionsResponseDto['sessions'][number],
  right: SessionsResponseDto['sessions'][number]
): number {
  if (left.isCurrent !== right.isCurrent) {
    return left.isCurrent ? -1 : 1;
  }

  return new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
}

function normalizeDeviceType(deviceType: string | null): string | null {
  return deviceType ? deviceType.toUpperCase() : null;
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

import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@football-manager/database';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

export const SESSION_CACHE = Symbol('SESSION_CACHE');

export type SessionCache = {
  get: (sessionId: string) => Promise<boolean | undefined>;
  set: (sessionId: string, isActive: boolean, ttlSeconds: number) => Promise<void>;
  delete: (sessionId: string) => Promise<void>;
};

export type CreateSessionInput = {
  userId: string;
  tokenFamilyId?: string;
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  operatingSystem?: string;
  ipHash?: string;
  countryCode?: string;
  city?: string;
  userAgentHash?: string;
  expiresAt: Date;
};

export type ActiveSession = {
  id: string;
  userId: string;
  userRole: string;
  expiresAt: Date;
};

export type ListedUserSession = {
  id: string;
  deviceName: string | null;
  deviceType: string | null;
  browser: string | null;
  operatingSystem: string | null;
  countryCode: string | null;
  city: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  expiresAt: Date;
};

export type RevokeOwnedSessionResult = {
  sessionId: string;
  wasActive: boolean;
};

export class SessionInactiveError extends Error {
  constructor(message = 'SESSION_INACTIVE') {
    super(message);
    this.name = 'SessionInactiveError';
  }
}

@Injectable()
export class SessionService {
  private readonly activeSessionCacheTtlSeconds = 60;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Optional() @Inject(SESSION_CACHE) private readonly cache?: SessionCache
  ) {}

  async createSession(input: CreateSessionInput, transaction?: Prisma.TransactionClient) {
    const now = new Date();
    const client = transaction ?? this.prisma;

    return client.userSession.create({
      data: {
        userId: input.userId,
        tokenFamilyId: input.tokenFamilyId ?? randomUUID(),
        deviceName: input.deviceName,
        deviceType: input.deviceType,
        browser: input.browser,
        operatingSystem: input.operatingSystem,
        ipHash: input.ipHash,
        countryCode: input.countryCode,
        city: input.city,
        userAgentHash: input.userAgentHash,
        lastSeenAt: now,
        expiresAt: input.expiresAt
      }
    });
  }

  async getActiveSession(sessionId: string, now = new Date()): Promise<ActiveSession | null> {
    const session = await this.prisma.userSession.findFirst({
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
        expiresAt: true,
        user: {
          select: {
            role: true
          }
        }
      }
    });

    if (!session) {
      return null;
    }

    return {
      id: session.id,
      userId: session.userId,
      userRole: session.user.role,
      expiresAt: session.expiresAt
    };
  }

  async assertSessionActive(sessionId: string, now = new Date()): Promise<void> {
    const cachedState = await this.readCachedState(sessionId);

    if (cachedState === true) {
      return;
    }

    if (cachedState === false) {
      throw new SessionInactiveError();
    }

    const session = await this.getActiveSession(sessionId, now);

    if (!session) {
      await this.writeCachedState(sessionId, false);
      throw new SessionInactiveError();
    }

    await this.writeCachedState(sessionId, true);
  }

  async listUserSessions(userId: string, now = new Date()): Promise<ListedUserSession[]> {
    return this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: now
        }
      },
      orderBy: {
        lastSeenAt: 'desc'
      },
      select: {
        id: true,
        deviceName: true,
        deviceType: true,
        browser: true,
        operatingSystem: true,
        countryCode: true,
        city: true,
        lastSeenAt: true,
        createdAt: true,
        expiresAt: true
      }
    });
  }

  async countActiveSessions(userId: string, now = new Date()): Promise<number> {
    return this.prisma.userSession.count({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: now
        }
      }
    });
  }

  async revokeSession(sessionId: string, revokeReason: string, revokedAt = new Date()): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: {
          id: sessionId,
          revokedAt: null
        },
        data: {
          revokedAt,
          revokeReason
        }
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          sessionId,
          revokedAt: null
        },
        data: {
          revokedAt
        }
      })
    ]);

    await this.invalidateCache(sessionId);
  }

  async revokeOwnedSession(
    userId: string,
    sessionId: string,
    revokeReason: string,
    revokedAt = new Date()
  ): Promise<RevokeOwnedSessionResult | null> {
    const session = await this.prisma.userSession.findFirst({
      where: {
        id: sessionId,
        userId
      },
      select: {
        id: true,
        revokedAt: true
      }
    });

    if (!session) {
      return null;
    }

    if (session.revokedAt !== null) {
      return {
        sessionId: session.id,
        wasActive: false
      };
    }

    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null
        },
        data: {
          revokedAt,
          revokeReason
        }
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          sessionId,
          revokedAt: null
        },
        data: {
          revokedAt
        }
      })
    ]);

    await this.invalidateCache(sessionId);

    return {
      sessionId: session.id,
      wasActive: true
    };
  }

  async revokeAllUserSessions(userId: string, revokeReason: string, revokedAt = new Date()): Promise<number> {
    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null
      },
      select: {
        id: true
      }
    });
    const sessionIds = sessions.map((session) => session.id);

    if (sessionIds.length === 0) {
      return 0;
    }

    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: {
          id: {
            in: sessionIds
          }
        },
        data: {
          revokedAt,
          revokeReason
        }
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          sessionId: {
            in: sessionIds
          },
          revokedAt: null
        },
        data: {
          revokedAt
        }
      })
    ]);

    await Promise.all(sessionIds.map((sessionId) => this.invalidateCache(sessionId)));

    return sessionIds.length;
  }

  async invalidateSessionCache(sessionId: string): Promise<void> {
    await this.invalidateCache(sessionId);
  }

  async invalidateSessionCaches(sessionIds: string[]): Promise<void> {
    await Promise.all(sessionIds.map((sessionId) => this.invalidateCache(sessionId)));
  }

  async updateLastSeen(sessionId: string, lastSeenAt = new Date()): Promise<void> {
    await this.prisma.userSession.update({
      where: {
        id: sessionId
      },
      data: {
        lastSeenAt
      }
    });
  }

  private async readCachedState(sessionId: string): Promise<boolean | undefined> {
    try {
      return await this.cache?.get(sessionId);
    } catch {
      return undefined;
    }
  }

  private async writeCachedState(sessionId: string, isActive: boolean): Promise<void> {
    try {
      await this.cache?.set(sessionId, isActive, this.activeSessionCacheTtlSeconds);
    } catch {
      // Redis cache is an optimization; database remains the source of truth.
    }
  }

  private async invalidateCache(sessionId: string): Promise<void> {
    try {
      await this.cache?.delete(sessionId);
    } catch {
      // Cache invalidation failure should not hide the database revoke result.
    }
  }
}

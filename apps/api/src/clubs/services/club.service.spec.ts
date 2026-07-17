import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClubBoardExpectation, ClubStatus, Prisma, UserRole } from '@football-manager/database';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { TokenHashService } from '../../auth/services/token-hash.service';
import { AUTH_AUDIT_EVENTS } from '../../auth/constants/auth-audit-events';
import { ClubService } from './club.service';

const requestContext = {
  requestId: 'req-club',
  clientIp: '127.0.0.1'
};
const user: AuthenticatedUser = {
  userId: 'user-1',
  role: UserRole.USER,
  sessionId: 'session-1'
};

describe('ClubService getMyClub', () => {
  it('returns the authenticated manager active club with private fields', async () => {
    const { service } = createService();

    const club = await service.getMyClub(user, requestContext);

    expect(club).toMatchObject({
      id: 'club-1',
      slug: 'northbridge-fc',
      status: ClubStatus.ACTIVE,
      currentManagerProfileId: 'manager-1',
      balance: '123456789012.34',
      transferBudget: '2500000.50',
      wageBudget: '750000.25'
    });
  });

  it('returns an inactive assigned club to its current manager', async () => {
    const { service } = createService();

    const club = await service.getMyClub(createUser('user-2'), requestContext);

    expect(club.status).toBe(ClubStatus.INACTIVE);
    expect(club.slug).toBe('southport-town');
  });

  it('rejects users without a manager profile', async () => {
    const { service } = createService();

    await expect(service.getMyClub(createUser('missing-user'), requestContext)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('rejects managers without an assigned club', async () => {
    const { database, service } = createService();
    database.managerProfiles.push({
      id: 'manager-empty',
      userId: 'user-empty',
      displayName: 'Empty Manager'
    });

    await expect(service.getMyClub(createUser('user-empty'), requestContext)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('does not return another manager club', async () => {
    const { service } = createService();

    const club = await service.getMyClub(user, requestContext);

    expect(club.slug).not.toBe('southport-town');
  });

  it('treats archived assigned clubs as not assigned', async () => {
    const { database, service } = createService();
    database.clubs[0].status = ClubStatus.ARCHIVED;

    await expect(service.getMyClub(user, requestContext)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serializes decimal money as strings without precision loss', async () => {
    const { service } = createService();

    const club = await service.getMyClub(user, requestContext);

    expect(club.balance).toBe('123456789012.34');
    expect(typeof club.balance).toBe('string');
  });

  it('serializes manager assignment timestamps as ISO strings', async () => {
    const { service } = createService();

    const club = await service.getMyClub(user, requestContext);

    expect(club.managerAssignedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('includes facility levels only in the manager-private response', async () => {
    const { service } = createService();

    const club = await service.getMyClub(user, requestContext);

    expect(club.trainingFacilityLevel).toBe(8);
    expect(club.youthFacilityLevel).toBe(6);
  });
});

describe('ClubService getPublicClubBySlug', () => {
  it('returns an active public club by slug', async () => {
    const { service } = createService();

    const club = await service.getPublicClubBySlug('northbridge-fc', requestContext);

    expect(club).toMatchObject({
      slug: 'northbridge-fc',
      status: ClubStatus.ACTIVE,
      managerDisplayName: 'Fatih Manager'
    });
  });

  it('normalizes slug casing before lookup', async () => {
    const { service } = createService();

    const club = await service.getPublicClubBySlug('Northbridge-FC', requestContext);

    expect(club.slug).toBe('northbridge-fc');
  });

  it('hides inactive clubs from public slug lookup', async () => {
    const { service } = createService();

    await expect(service.getPublicClubBySlug('southport-town', requestContext)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('hides archived clubs from public slug lookup', async () => {
    const { database, service } = createService();
    database.clubs.push(createClub({ id: 'club-archived', slug: 'archived-fc', status: ClubStatus.ARCHIVED }));

    await expect(service.getPublicClubBySlug('archived-fc', requestContext)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('returns not found for unknown slugs', async () => {
    const { service } = createService();

    await expect(service.getPublicClubBySlug('unknown-fc', requestContext)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('returns not found for malformed slugs', async () => {
    const { service } = createService();

    await expect(service.getPublicClubBySlug('../northbridge-fc', requestContext)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('does not expose private finance fields in public detail responses', async () => {
    const { service } = createService();

    const club = await service.getPublicClubBySlug('northbridge-fc', requestContext);

    expect(JSON.stringify(club)).not.toContain('balance');
    expect(JSON.stringify(club)).not.toContain('transferBudget');
    expect(JSON.stringify(club)).not.toContain('wageBudget');
  });

  it('does not expose internal manager identifiers in public detail responses', async () => {
    const { service } = createService();

    const club = await service.getPublicClubBySlug('northbridge-fc', requestContext);

    expect(JSON.stringify(club)).not.toContain('currentManagerProfileId');
    expect(JSON.stringify(club)).not.toContain('user-1');
  });
});

describe('ClubService listPublicClubs', () => {
  it('uses default pagination values', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({}, requestContext);

    expect(result.pagination).toMatchObject({
      page: 1,
      pageSize: 20
    });
  });

  it('sorts clubs by name and id for stable public lists', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({}, requestContext);

    expect(result.items.map((club) => club.slug)).toEqual(['ai-united', 'northbridge-fc', 'riverport-athletic']);
  });

  it('applies page and pageSize', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({ page: 2, pageSize: 1 }, requestContext);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].slug).toBe('northbridge-fc');
    expect(result.pagination.totalPages).toBe(3);
  });

  it('allows pageSize 100', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({ pageSize: 100 }, requestContext);

    expect(result.pagination.pageSize).toBe(100);
  });

  it('rejects page zero', async () => {
    const { service } = createService();

    await expect(service.listPublicClubs({ page: 0 }, requestContext)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects pageSize over 100', async () => {
    const { service } = createService();

    await expect(service.listPublicClubs({ pageSize: 101 }, requestContext)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('filters public clubs by countryCode', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({ countryCode: 'GB' }, requestContext);

    expect(result.items.map((club) => club.slug)).toEqual(['northbridge-fc']);
  });

  it('rejects invalid countryCode values', async () => {
    const { service } = createService();

    await expect(service.listPublicClubs({ countryCode: 'GBR' }, requestContext)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('trims search text before matching', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({ search: '  riverport  ' }, requestContext);

    expect(result.items.map((club) => club.slug)).toEqual(['riverport-athletic']);
  });

  it('matches search against name, short name, slug, and three-letter code', async () => {
    const { service } = createService();

    await expect(service.listPublicClubs({ search: 'NBR' }, requestContext)).resolves.toMatchObject({
      items: [expect.objectContaining({ slug: 'northbridge-fc' })]
    });
    await expect(service.listPublicClubs({ search: 'Athletic' }, requestContext)).resolves.toMatchObject({
      items: [expect.objectContaining({ slug: 'riverport-athletic' })]
    });
    await expect(service.listPublicClubs({ search: 'ai-united' }, requestContext)).resolves.toMatchObject({
      items: [expect.objectContaining({ slug: 'ai-united' })]
    });
  });

  it('lists only ACTIVE public clubs', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({}, requestContext);

    expect(result.items.map((club) => club.slug)).not.toContain('southport-town');
  });

  it('returns zero total pages when no clubs match', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({ search: 'no-match' }, requestContext);

    expect(result.pagination.totalItems).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });

  it('includes active managerless AI clubs in public lists', async () => {
    const { service } = createService();

    const result = await service.listPublicClubs({ search: 'AI' }, requestContext);

    expect(result.items.map((club) => club.slug)).toEqual(['ai-united']);
  });
});

describe('ClubService updateMyClubSettings', () => {
  it('updates allowed presentation fields and records an audit log', async () => {
    const { database, service } = createService();

    const result = await service.updateMyClubSettings(
      user,
      {
        shortName: 'Northbridge',
        primaryColor: '#112233',
        secondaryColor: '#445566'
      },
      requestContext
    );

    expect(result.changedFields).toEqual(['shortName', 'primaryColor', 'secondaryColor']);
    expect(result.club.shortName).toBe('Northbridge');
    expect(database.auditLogs[0]).toMatchObject({
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      action: AUTH_AUDIT_EVENTS.CLUB_SETTINGS_UPDATED,
      entityType: 'Club',
      entityId: 'club-1',
      metadata: {
        changedFields: ['shortName', 'primaryColor', 'secondaryColor'],
        clubId: 'club-1',
        managerProfileId: 'manager-1'
      },
      ipHash: 'hash:ip:127.0.0.1'
    });
  });

  it('normalizes color values to uppercase hex', async () => {
    const { service } = createService();

    const result = await service.updateMyClubSettings(user, { primaryColor: '#abcdef' }, requestContext);

    expect(result.club.primaryColor).toBe('#ABCDEF');
  });

  it('updates only sent fields and preserves omitted fields', async () => {
    const { service } = createService();

    const result = await service.updateMyClubSettings(user, { shortName: 'NBR City' }, requestContext);

    expect(result.club.shortName).toBe('NBR City');
    expect(result.club.primaryColor).toBe('#123456');
    expect(result.club.secondaryColor).toBe('#FFFFFF');
  });

  it('returns 200-style data and skips audit on no-op updates', async () => {
    const { database, service } = createService();

    const result = await service.updateMyClubSettings(user, { shortName: 'NBR' }, requestContext);

    expect(result.changedFields).toEqual([]);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('rejects unknown mass-assignment fields', async () => {
    const { service } = createService();

    await expect(
      service.updateMyClubSettings(user, { unknown: 'value' } as never, requestContext)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects balance updates from manager payloads', async () => {
    const { service } = createService();

    await expect(
      service.updateMyClubSettings(user, { balance: '999999.00' } as never, requestContext)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects client-supplied clubId values', async () => {
    const { service } = createService();

    await expect(
      service.updateMyClubSettings(user, { clubId: 'club-2', shortName: 'Wrong' } as never, requestContext)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects users without manager profiles', async () => {
    const { service } = createService();

    await expect(
      service.updateMyClubSettings(createUser('missing-user'), { shortName: 'None' }, requestContext)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects managers without an assigned club', async () => {
    const { database, service } = createService();
    database.managerProfiles.push({
      id: 'manager-empty',
      userId: 'user-empty',
      displayName: 'Empty Manager'
    });

    await expect(
      service.updateMyClubSettings(createUser('user-empty'), { shortName: 'None' }, requestContext)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows current managers to update their inactive assigned club', async () => {
    const { service } = createService();

    const result = await service.updateMyClubSettings(
      createUser('user-2'),
      { shortName: 'Southport' },
      requestContext
    );

    expect(result.club.status).toBe(ClubStatus.INACTIVE);
    expect(result.club.shortName).toBe('Southport');
  });

  it('does not update archived clubs', async () => {
    const { database, service } = createService();
    database.clubs[0].status = ClubStatus.ARCHIVED;

    await expect(service.updateMyClubSettings(user, { shortName: 'Archived' }, requestContext)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('does not let one manager update another manager club', async () => {
    const { database, service } = createService();

    await service.updateMyClubSettings(createUser('user-2'), { shortName: 'South' }, requestContext);

    expect(database.clubs.find((club) => club.id === 'club-1')?.shortName).toBe('NBR');
    expect(database.clubs.find((club) => club.id === 'club-2')?.shortName).toBe('South');
  });

  it('keeps audit metadata allowlisted and does not store raw request bodies', async () => {
    const { database, service } = createService();

    await service.updateMyClubSettings(user, { shortName: 'North' }, requestContext);

    const audit = database.auditLogs[0];
    expect(Object.keys(audit.metadata)).toEqual(['changedFields', 'clubId', 'managerProfileId']);
    expect(JSON.stringify(audit)).not.toContain('refresh');
    expect(JSON.stringify(audit)).not.toContain('authorization');
    expect(JSON.stringify(audit)).not.toContain('Northbridge FC');
  });

  it('rolls back updates when audit writing fails', async () => {
    const { database, service } = createService({ failAudit: true });

    await expect(service.updateMyClubSettings(user, { shortName: 'Rollback' }, requestContext)).rejects.toThrow(
      'audit failed'
    );

    expect(database.clubs.find((club) => club.id === 'club-1')?.shortName).toBe('NBR');
  });

  it('rejects arbitrary logo URL updates', async () => {
    const { service } = createService();

    await expect(
      service.updateMyClubSettings(user, { logoUrl: 'https://example.invalid/logo.png' } as never, requestContext)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects transferBudget updates from manager payloads', async () => {
    const { service } = createService();

    await expect(
      service.updateMyClubSettings(user, { transferBudget: '1000000.00' } as never, requestContext)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps financial precision after a presentation update', async () => {
    const { service } = createService();

    const result = await service.updateMyClubSettings(user, { secondaryColor: '#000001' }, requestContext);

    expect(result.club.balance).toBe('123456789012.34');
    expect(result.club.transferBudget).toBe('2500000.50');
    expect(result.club.wageBudget).toBe('750000.25');
  });
});

type StoredManagerProfile = {
  id: string;
  userId: string;
  displayName: string;
};

type StoredAuditLog = {
  actorUserId: string;
  targetUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ipHash: string;
};

type StoredClub = {
  id: string;
  currentManagerProfileId: string | null;
  name: string;
  shortName: string;
  slug: string;
  threeLetterCode: string | null;
  primaryColor: string;
  secondaryColor: string;
  logoAssetKey: string | null;
  countryCode: string;
  city: string;
  status: ClubStatus;
  balance: Prisma.Decimal;
  transferBudget: Prisma.Decimal;
  wageBudget: Prisma.Decimal;
  currencyCode: string;
  premiumCurrency: number;
  reputation: number;
  fanBase: number;
  foundedYear: number | null;
  foundedAt: Date;
  managerAssignedAt: Date | null;
  stadiumName: string;
  stadiumCapacity: number;
  trainingFacilityLevel: number;
  youthFacilityLevel: number;
  currentLeagueId: string | null;
  divisionLevel: number | null;
  boardExpectation: ClubBoardExpectation;
  createdAt: Date;
  updatedAt: Date;
};

type InMemoryClubDatabase = {
  managerProfiles: StoredManagerProfile[];
  clubs: StoredClub[];
  auditLogs: StoredAuditLog[];
  prisma: unknown;
};

function createService(options: { failAudit?: boolean } = {}) {
  const database = createDatabase(options);
  const tokenHashService = {
    hashToken: (value: string) => `hash:${value}`
  } as TokenHashService;
  const service = new ClubService(database.prisma as PrismaService, tokenHashService);

  return {
    database,
    service
  };
}

function createDatabase(options: { failAudit?: boolean }): InMemoryClubDatabase {
  const database: InMemoryClubDatabase = {
    managerProfiles: [
      {
        id: 'manager-1',
        userId: 'user-1',
        displayName: 'Fatih Manager'
      },
      {
        id: 'manager-2',
        userId: 'user-2',
        displayName: 'Second Manager'
      }
    ],
    clubs: [
      createClub({
        id: 'club-1',
        currentManagerProfileId: 'manager-1',
        name: 'Northbridge FC',
        shortName: 'NBR',
        slug: 'northbridge-fc',
        threeLetterCode: 'NBR',
        countryCode: 'GB',
        city: 'Northbridge',
        primaryColor: '#123456',
        secondaryColor: '#FFFFFF',
        balance: new Prisma.Decimal('123456789012.34'),
        transferBudget: new Prisma.Decimal('2500000.50'),
        wageBudget: new Prisma.Decimal('750000.25'),
        reputation: 6500,
        fanBase: 18000,
        managerAssignedAt: new Date('2026-07-01T00:00:00.000Z'),
        trainingFacilityLevel: 8,
        youthFacilityLevel: 6
      }),
      createClub({
        id: 'club-2',
        currentManagerProfileId: 'manager-2',
        name: 'Southport Town',
        shortName: 'SPT',
        slug: 'southport-town',
        threeLetterCode: 'SPT',
        status: ClubStatus.INACTIVE,
        countryCode: 'GB'
      }),
      createClub({
        id: 'club-3',
        currentManagerProfileId: null,
        name: 'Riverport Athletic',
        shortName: 'RPA',
        slug: 'riverport-athletic',
        threeLetterCode: 'RPA',
        countryCode: 'TR'
      }),
      createClub({
        id: 'club-4',
        currentManagerProfileId: null,
        name: 'AI United',
        shortName: 'AIU',
        slug: 'ai-united',
        threeLetterCode: 'AIU',
        countryCode: 'TR'
      })
    ],
    auditLogs: [],
    prisma: {}
  };
  const prisma = createPrisma(database, options);
  database.prisma = prisma;

  return database;
}

function createPrisma(database: InMemoryClubDatabase, options: { failAudit?: boolean }) {
  const transaction = createTransaction(database, options);

  return {
    managerProfile: transaction.managerProfile,
    club: transaction.club,
    auditLog: transaction.auditLog,
    $transaction: async <T>(callback: (client: ReturnType<typeof createTransaction>) => Promise<T>) => {
      const clubSnapshot = database.clubs.map((club) => ({ ...club }));
      const auditSnapshot = database.auditLogs.map((audit) => ({ ...audit, metadata: { ...audit.metadata } }));

      try {
        return await callback(transaction);
      } catch (error) {
        database.clubs.splice(0, database.clubs.length, ...clubSnapshot);
        database.auditLogs.splice(0, database.auditLogs.length, ...auditSnapshot);
        throw error;
      }
    }
  };
}

function createTransaction(database: InMemoryClubDatabase, options: { failAudit?: boolean }) {
  return {
    managerProfile: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        database.managerProfiles.find((profile) => profile.userId === where.userId) ?? null
    },
    club: {
      findFirst: async ({ where }: { where: ClubWhere }) => database.clubs.find((club) => matchesClubWhere(club, where))
        ? withManagerProfile(database, database.clubs.find((club) => matchesClubWhere(club, where)) as StoredClub)
        : null,
      count: async ({ where }: { where: ClubWhere }) => database.clubs.filter((club) => matchesClubWhere(club, where)).length,
      findMany: async ({
        where,
        skip,
        take
      }: {
        where: ClubWhere;
        skip: number;
        take: number;
      }) =>
        database.clubs
          .filter((club) => matchesClubWhere(club, where))
          .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
          .slice(skip, skip + take)
          .map((club) => withManagerProfile(database, club)),
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<Record<'shortName' | 'primaryColor' | 'secondaryColor', string | undefined>>;
      }) => {
        const club = database.clubs.find((storedClub) => storedClub.id === where.id);

        if (!club) {
          throw new Error('club not found');
        }

        for (const [fieldName, value] of Object.entries(data)) {
          if (value !== undefined) {
            (club as unknown as Record<string, string>)[fieldName] = value;
          }
        }

        club.updatedAt = new Date('2026-07-17T12:00:00.000Z');

        return withManagerProfile(database, club);
      }
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        if (options.failAudit) {
          throw new Error('audit failed');
        }

        database.auditLogs.push(data);
      }
    }
  };
}

type ClubWhere = {
  currentManagerProfileId?: string;
  slug?: string;
  status?: ClubStatus | { not: ClubStatus };
  countryCode?: string;
  OR?: Array<Record<string, { contains: string; mode: string }>>;
};

function matchesClubWhere(club: StoredClub, where: ClubWhere): boolean {
  if (where.currentManagerProfileId !== undefined && club.currentManagerProfileId !== where.currentManagerProfileId) {
    return false;
  }

  if (where.slug !== undefined && club.slug !== where.slug) {
    return false;
  }

  if (where.status !== undefined) {
    if (typeof where.status === 'string' && club.status !== where.status) {
      return false;
    }

    if (typeof where.status === 'object' && club.status === where.status.not) {
      return false;
    }
  }

  if (where.countryCode !== undefined && club.countryCode !== where.countryCode) {
    return false;
  }

  if (where.OR && !where.OR.some((condition) => matchesSearchCondition(club, condition))) {
    return false;
  }

  return true;
}

function matchesSearchCondition(club: StoredClub, condition: Record<string, { contains: string }>): boolean {
  return Object.entries(condition).some(([fieldName, filter]) => {
    const value = (club as unknown as Record<string, string | null>)[fieldName];

    return typeof value === 'string' && value.toLowerCase().includes(filter.contains.toLowerCase());
  });
}

function withManagerProfile(database: InMemoryClubDatabase, club: StoredClub) {
  const managerProfile =
    database.managerProfiles.find((profile) => profile.id === club.currentManagerProfileId) ?? null;

  return {
    ...club,
    currentManagerProfile: managerProfile
      ? {
          displayName: managerProfile.displayName
        }
      : null
  };
}

function createClub(overrides: Partial<StoredClub> = {}): StoredClub {
  return {
    id: 'club-fixture',
    currentManagerProfileId: null,
    name: 'Fixture FC',
    shortName: 'FFC',
    slug: 'fixture-fc',
    threeLetterCode: 'FFC',
    primaryColor: '#000000',
    secondaryColor: '#FFFFFF',
    logoAssetKey: null,
    countryCode: 'TR',
    city: 'Istanbul',
    status: ClubStatus.ACTIVE,
    balance: new Prisma.Decimal('0.00'),
    transferBudget: new Prisma.Decimal('0.00'),
    wageBudget: new Prisma.Decimal('0.00'),
    currencyCode: 'EUR',
    premiumCurrency: 0,
    reputation: 1000,
    fanBase: 1000,
    foundedYear: 2026,
    foundedAt: new Date('2026-01-01T00:00:00.000Z'),
    managerAssignedAt: null,
    stadiumName: 'Main Stadium',
    stadiumCapacity: 10000,
    trainingFacilityLevel: 1,
    youthFacilityLevel: 1,
    currentLeagueId: null,
    divisionLevel: null,
    boardExpectation: ClubBoardExpectation.STABLE_SEASON,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

function createUser(userId: string): AuthenticatedUser {
  return {
    ...user,
    userId
  };
}

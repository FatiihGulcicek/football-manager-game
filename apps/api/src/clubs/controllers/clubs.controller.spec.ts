import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClubStatus, UserRole } from '@football-manager/database';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthUnauthorizedException } from '../../auth/errors/auth-unauthorized.exception';
import { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { ClubNotAssignedException, ClubNotFoundException } from '../errors/club.exceptions';
import { ClubService } from '../services/club.service';
import { ClubsController } from './clubs.controller';

const config: AuthConfig = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
  emailVerifyTtlSeconds: 86_400,
  passwordResetTtlSeconds: 1_800,
  refreshGraceSeconds: 5,
  jwtIssuer: 'football-manager-auth',
  jwtAudience: 'football-manager-api',
  jwtActiveKid: 'test',
  jwtPrivateKey: 'unused',
  jwtPublicKeys: { test: 'unused' },
  tokenPepper: 'test-pepper',
  cookieName: 'refresh_token',
  cookieSecure: false,
  cookieSameSite: 'lax',
  cookiePath: '/',
  trustProxyCidrs: [],
  argon2MemoryCost: 1_024,
  argon2TimeCost: 2,
  argon2Parallelism: 1
};
const authenticatedUser: AuthenticatedUser = {
  userId: 'user-1',
  role: UserRole.USER,
  sessionId: 'session-1'
};

describe('ClubsController', () => {
  let app: INestApplication;
  let service: ClubServiceMock;
  let guardUser: AuthenticatedUser | undefined;

  beforeEach(async () => {
    guardUser = authenticatedUser;
    service = createClubServiceMock();

    const authGuard: CanActivate = {
      canActivate: (context: ExecutionContext) => {
        if (!guardUser) {
          throw new AuthUnauthorizedException('req-club');
        }

        context.switchToHttp().getRequest().authenticatedUser = guardUser;

        return true;
      }
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ClubsController],
      providers: [
        {
          provide: ClubService,
          useValue: service
        },
        {
          provide: AUTH_CONFIG,
          useValue: config
        }
      ]
    })
      .overrideGuard(AccessTokenGuard)
      .useValue(authGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true
      })
    );
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('returns the authenticated manager club from GET /clubs/me', async () => {
    service.getMyClub.mockResolvedValue(createPrivateClub());

    const response = await request(app.getHttpServer()).get('/clubs/me').set('x-request-id', 'req-1').expect(200);

    expect(response.body).toMatchObject({
      id: 'club-1',
      slug: 'northbridge-fc',
      balance: '123.45'
    });
    expect(service.getMyClub).toHaveBeenCalledWith(
      authenticatedUser,
      expect.objectContaining({
        requestId: 'req-1'
      })
    );
  });

  it('requires authentication for GET /clubs/me', async () => {
    guardUser = undefined;

    const response = await request(app.getHttpServer()).get('/clubs/me').expect(401);

    expect(response.body.error.code).toBe('AUTH_UNAUTHORIZED');
    expect(service.getMyClub).not.toHaveBeenCalled();
  });

  it('returns CLUB_NOT_ASSIGNED from GET /clubs/me when no club exists', async () => {
    service.getMyClub.mockRejectedValue(new ClubNotAssignedException('req-1'));

    const response = await request(app.getHttpServer()).get('/clubs/me').set('x-request-id', 'req-1').expect(404);

    expect(response.body.error).toEqual({
      code: 'CLUB_NOT_ASSIGNED',
      message: 'Yonetilen kulup bulunamadi.',
      requestId: 'req-1'
    });
  });

  it('returns a public club by slug without authentication', async () => {
    guardUser = undefined;
    service.getPublicClubBySlug.mockResolvedValue(createPublicClub());

    const response = await request(app.getHttpServer()).get('/clubs/northbridge-fc').expect(200);

    expect(response.body).toMatchObject({
      slug: 'northbridge-fc',
      status: ClubStatus.ACTIVE
    });
    expect(response.body).not.toHaveProperty('balance');
  });

  it('returns CLUB_NOT_FOUND for inactive or unknown public clubs', async () => {
    guardUser = undefined;
    service.getPublicClubBySlug.mockRejectedValue(new ClubNotFoundException('req-public'));

    const response = await request(app.getHttpServer())
      .get('/clubs/southport-town')
      .set('x-request-id', 'req-public')
      .expect(404);

    expect(response.body.error.code).toBe('CLUB_NOT_FOUND');
  });

  it('lists public clubs with default pagination', async () => {
    guardUser = undefined;
    service.listPublicClubs.mockResolvedValue({
      items: [createPublicSummaryClub()],
      pagination: {
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1
      }
    });

    const response = await request(app.getHttpServer()).get('/clubs').expect(200);

    expect(response.body.pagination).toEqual({
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1
    });
    expect(service.listPublicClubs).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });

  it('rejects invalid public list pagination before service execution', async () => {
    guardUser = undefined;

    await request(app.getHttpServer()).get('/clubs?page=0').expect(400);

    expect(service.listPublicClubs).not.toHaveBeenCalled();
  });

  it('passes trimmed and normalized list filters to the service', async () => {
    guardUser = undefined;
    service.listPublicClubs.mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0
      }
    });

    await request(app.getHttpServer()).get('/clubs?search=%20North%20&countryCode=gb&page=1&pageSize=10').expect(200);

    expect(service.listPublicClubs).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'North',
        countryCode: 'GB',
        page: 1,
        pageSize: 10
      }),
      expect.any(Object)
    );
  });

  it('updates manager-owned club settings from PATCH /clubs/me', async () => {
    service.updateMyClubSettings.mockResolvedValue({
      club: createPrivateClub({ shortName: 'Northbridge', primaryColor: '#ABCDEF' }),
      changedFields: ['shortName', 'primaryColor']
    });

    const response = await request(app.getHttpServer())
      .patch('/clubs/me')
      .set('x-request-id', 'req-patch')
      .send({
        shortName: 'Northbridge',
        primaryColor: '#abcdef'
      })
      .expect(200);

    expect(response.body.changedFields).toEqual(['shortName', 'primaryColor']);
    expect(service.updateMyClubSettings).toHaveBeenCalledWith(
      authenticatedUser,
      expect.objectContaining({
        shortName: 'Northbridge',
        primaryColor: '#ABCDEF'
      }),
      expect.objectContaining({
        requestId: 'req-patch'
      })
    );
  });

  it('requires authentication for PATCH /clubs/me', async () => {
    guardUser = undefined;

    await request(app.getHttpServer()).patch('/clubs/me').send({ shortName: 'North' }).expect(401);

    expect(service.updateMyClubSettings).not.toHaveBeenCalled();
  });

  it('rejects protected mass-assignment fields in PATCH /clubs/me', async () => {
    await request(app.getHttpServer())
      .patch('/clubs/me')
      .send({
        clubId: 'club-2',
        balance: '999999.00',
        shortName: 'North'
      })
      .expect(400);

    expect(service.updateMyClubSettings).not.toHaveBeenCalled();
  });

  it('rejects invalid color input in PATCH /clubs/me', async () => {
    await request(app.getHttpServer())
      .patch('/clubs/me')
      .send({
        primaryColor: '#zzzzzz'
      })
      .expect(400);

    expect(service.updateMyClubSettings).not.toHaveBeenCalled();
  });

  it('does not expose cookies or tokens from club endpoints', async () => {
    service.getMyClub.mockResolvedValue(createPrivateClub());

    const response = await request(app.getHttpServer()).get('/clubs/me').expect(200);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('token');
    expect(JSON.stringify(response.body)).not.toContain('cookie');
  });
});

type ClubServiceMock = {
  getMyClub: ReturnType<typeof vi.fn>;
  getPublicClubBySlug: ReturnType<typeof vi.fn>;
  listPublicClubs: ReturnType<typeof vi.fn>;
  updateMyClubSettings: ReturnType<typeof vi.fn>;
};

function createClubServiceMock(): ClubServiceMock {
  return {
    getMyClub: vi.fn(),
    getPublicClubBySlug: vi.fn(),
    listPublicClubs: vi.fn(),
    updateMyClubSettings: vi.fn()
  };
}

function createPublicSummaryClub(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'northbridge-fc',
    name: 'Northbridge FC',
    shortName: 'NBR',
    threeLetterCode: 'NBR',
    primaryColor: '#123456',
    secondaryColor: '#FFFFFF',
    logoAssetKey: null,
    countryCode: 'GB',
    city: 'Northbridge',
    reputation: 6500,
    fanBase: 18000,
    foundedYear: 2026,
    stadiumName: 'Northbridge Park',
    stadiumCapacity: 22000,
    ...overrides
  };
}

function createPublicClub(overrides: Record<string, unknown> = {}) {
  return {
    ...createPublicSummaryClub(),
    status: ClubStatus.ACTIVE,
    managerDisplayName: 'Fatih Manager',
    divisionLevel: null,
    boardExpectation: 'STABLE_SEASON',
    ...overrides
  };
}

function createPrivateClub(overrides: Record<string, unknown> = {}) {
  return {
    ...createPublicClub(),
    id: 'club-1',
    status: ClubStatus.ACTIVE,
    currentManagerProfileId: 'manager-1',
    managerAssignedAt: '2026-07-01T00:00:00.000Z',
    balance: '123.45',
    transferBudget: '2500000.50',
    wageBudget: '750000.25',
    currencyCode: 'EUR',
    trainingFacilityLevel: 8,
    youthFacilityLevel: 6,
    currentLeagueId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

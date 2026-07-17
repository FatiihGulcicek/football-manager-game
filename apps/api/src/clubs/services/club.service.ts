import { Inject, Injectable } from '@nestjs/common';
import { ClubStatus, Prisma } from '@football-manager/database';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../../auth/constants/auth-audit-events';
import { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { TokenHashService } from '../../auth/services/token-hash.service';
import {
  assertValidClubSlug,
  ClubListQueryDto,
  ClubListResponseDto,
  ClubPrivateDto,
  ClubPublicDetailDto,
  ClubPublicSummaryDto,
  ClubSettingsUpdateResultDto,
  UpdateMyClubSettingsDto
} from '../dto/club.dto';
import { ClubInvalidSettingsException, ClubNotAssignedException, ClubNotFoundException } from '../errors/club.exceptions';

export type ClubRequestContext = {
  requestId: string;
  clientIp?: string;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CLUB_PUBLIC_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  threeLetterCode: true,
  primaryColor: true,
  secondaryColor: true,
  logoAssetKey: true,
  countryCode: true,
  city: true,
  status: true,
  reputation: true,
  fanBase: true,
  foundedYear: true,
  stadiumName: true,
  stadiumCapacity: true,
  divisionLevel: true,
  boardExpectation: true,
  currentManagerProfile: {
    select: {
      displayName: true
    }
  }
} satisfies Prisma.ClubSelect;
const CLUB_PRIVATE_SELECT = {
  ...CLUB_PUBLIC_SELECT,
  currentManagerProfileId: true,
  managerAssignedAt: true,
  balance: true,
  transferBudget: true,
  wageBudget: true,
  currencyCode: true,
  trainingFacilityLevel: true,
  youthFacilityLevel: true,
  currentLeagueId: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ClubSelect;
const UPDATE_FIELD_NAMES = ['shortName', 'primaryColor', 'secondaryColor'] as const;

type ClubPublicRecord = Prisma.ClubGetPayload<{ select: typeof CLUB_PUBLIC_SELECT }>;
type ClubPrivateRecord = Prisma.ClubGetPayload<{ select: typeof CLUB_PRIVATE_SELECT }>;
type UpdateFieldName = (typeof UPDATE_FIELD_NAMES)[number];

@Injectable()
export class ClubService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(TokenHashService)
    private readonly tokenHashService: TokenHashService
  ) {}

  async getMyClub(user: AuthenticatedUser, context: ClubRequestContext): Promise<ClubPrivateDto> {
    const managerProfile = await this.prisma.managerProfile.findUnique({
      where: {
        userId: user.userId
      },
      select: {
        id: true
      }
    });

    if (!managerProfile) {
      throw new ClubNotAssignedException(context.requestId);
    }

    const club = await this.prisma.club.findFirst({
      where: {
        currentManagerProfileId: managerProfile.id,
        status: {
          not: ClubStatus.ARCHIVED
        }
      },
      select: CLUB_PRIVATE_SELECT
    });

    if (!club) {
      throw new ClubNotAssignedException(context.requestId);
    }

    return mapPrivateClub(club);
  }

  async getPublicClubBySlug(slug: string, context: ClubRequestContext): Promise<ClubPublicDetailDto> {
    const normalizedSlug = normalizeSlugOrThrowNotFound(slug, context.requestId);
    const club = await this.prisma.club.findFirst({
      where: {
        slug: normalizedSlug,
        status: ClubStatus.ACTIVE
      },
      select: CLUB_PUBLIC_SELECT
    });

    if (!club) {
      throw new ClubNotFoundException(context.requestId);
    }

    return mapPublicDetailClub(club);
  }

  async listPublicClubs(query: ClubListQueryDto, context: ClubRequestContext): Promise<ClubListResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new ClubInvalidSettingsException(context.requestId);
    }

    const search = normalizeSearch(query.search);
    const countryCode = normalizeCountryCode(query.countryCode, context.requestId);
    const where: Prisma.ClubWhereInput = {
      status: ClubStatus.ACTIVE,
      ...(countryCode
        ? {
            countryCode
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                name: {
                  contains: search,
                  mode: 'insensitive'
                }
              },
              {
                shortName: {
                  contains: search,
                  mode: 'insensitive'
                }
              },
              {
                slug: {
                  contains: search.toLowerCase(),
                  mode: 'insensitive'
                }
              },
              {
                threeLetterCode: {
                  contains: search.toUpperCase(),
                  mode: 'insensitive'
                }
              }
            ]
          }
        : {})
    };

    const [totalItems, clubs] = await Promise.all([
      this.prisma.club.count({
        where
      }),
      this.prisma.club.findMany({
        where,
        orderBy: [
          {
            name: 'asc'
          },
          {
            id: 'asc'
          }
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: CLUB_PUBLIC_SELECT
      })
    ]);

    return {
      items: clubs.map(mapPublicSummaryClub),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize)
      }
    };
  }

  async updateMyClubSettings(
    user: AuthenticatedUser,
    dto: UpdateMyClubSettingsDto,
    context: ClubRequestContext
  ): Promise<ClubSettingsUpdateResultDto> {
    assertOnlyAllowedUpdateFields(dto, context.requestId);

    return this.prisma.$transaction(async (transaction) => {
      const managerProfile = await transaction.managerProfile.findUnique({
        where: {
          userId: user.userId
        },
        select: {
          id: true
        }
      });

      if (!managerProfile) {
        throw new ClubNotAssignedException(context.requestId);
      }

      const club = await transaction.club.findFirst({
        where: {
          currentManagerProfileId: managerProfile.id,
          status: {
            not: ClubStatus.ARCHIVED
          }
        },
        select: CLUB_PRIVATE_SELECT
      });

      if (!club) {
        throw new ClubNotAssignedException(context.requestId);
      }

      const data = buildClubSettingsUpdateData(dto);
      const changedFields = UPDATE_FIELD_NAMES.filter((fieldName) => {
        const value = data[fieldName];

        return value !== undefined && value !== club[fieldName];
      });

      if (changedFields.length === 0) {
        return {
          club: mapPrivateClub(club),
          changedFields
        };
      }

      const updatedClub = await transaction.club.update({
        where: {
          id: club.id
        },
        data,
        select: CLUB_PRIVATE_SELECT
      });

      await transaction.auditLog.create({
        data: {
          actorUserId: user.userId,
          targetUserId: user.userId,
          action: AUTH_AUDIT_EVENTS.CLUB_SETTINGS_UPDATED,
          entityType: 'Club',
          entityId: club.id,
          metadata: {
            changedFields,
            clubId: club.id,
            managerProfileId: managerProfile.id
          },
          ipHash: this.hashClientIp(context.clientIp)
        }
      });

      return {
        club: mapPrivateClub(updatedClub),
        changedFields
      };
    });
  }

  private hashClientIp(clientIp: string | undefined): string {
    const normalizedIp = normalizeContextText(clientIp ?? 'unknown', 128);

    return this.tokenHashService.hashToken(`ip:${normalizedIp}`);
  }
}

function mapPublicSummaryClub(club: ClubPublicRecord): ClubPublicSummaryDto {
  return {
    slug: club.slug,
    name: club.name,
    shortName: club.shortName,
    threeLetterCode: club.threeLetterCode,
    primaryColor: club.primaryColor,
    secondaryColor: club.secondaryColor,
    logoAssetKey: club.logoAssetKey,
    countryCode: club.countryCode,
    city: club.city,
    reputation: club.reputation,
    fanBase: club.fanBase,
    foundedYear: club.foundedYear,
    stadiumName: club.stadiumName,
    stadiumCapacity: club.stadiumCapacity
  };
}

function mapPublicDetailClub(club: ClubPublicRecord): ClubPublicDetailDto {
  return {
    ...mapPublicSummaryClub(club),
    status: ClubStatus.ACTIVE,
    managerDisplayName: club.currentManagerProfile?.displayName ?? null,
    divisionLevel: club.divisionLevel,
    boardExpectation: club.boardExpectation
  };
}

function mapPrivateClub(club: ClubPrivateRecord): ClubPrivateDto {
  if (!club.currentManagerProfileId) {
    throw new Error('private_club_requires_manager_profile');
  }

  return {
    ...mapPublicDetailClub(club),
    id: club.id,
    status: club.status as ClubPrivateDto['status'],
    currentManagerProfileId: club.currentManagerProfileId,
    managerAssignedAt: club.managerAssignedAt?.toISOString() ?? null,
    balance: decimalToString(club.balance),
    transferBudget: decimalToString(club.transferBudget),
    wageBudget: decimalToString(club.wageBudget),
    currencyCode: club.currencyCode,
    trainingFacilityLevel: club.trainingFacilityLevel,
    youthFacilityLevel: club.youthFacilityLevel,
    currentLeagueId: club.currentLeagueId,
    createdAt: club.createdAt.toISOString(),
    updatedAt: club.updatedAt.toISOString()
  };
}

function decimalToString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function normalizeSlugOrThrowNotFound(slug: string, requestId: string): string {
  try {
    return assertValidClubSlug(slug);
  } catch {
    throw new ClubNotFoundException(requestId);
  }
}

function normalizeSearch(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return undefined;
  }

  return Array.from(normalizedValue).slice(0, 80).join('');
}

function normalizeCountryCode(value: string | undefined, requestId: string): string | undefined {
  const normalizedValue = value?.trim().toUpperCase();

  if (!normalizedValue) {
    return undefined;
  }

  if (!/^[A-Z]{2}$/.test(normalizedValue)) {
    throw new ClubInvalidSettingsException(requestId);
  }

  return normalizedValue;
}

function assertOnlyAllowedUpdateFields(dto: UpdateMyClubSettingsDto, requestId: string): void {
  const unknownFields = Object.keys(dto).filter(
    (fieldName) => !(UPDATE_FIELD_NAMES as readonly string[]).includes(fieldName)
  );

  if (unknownFields.length > 0) {
    throw new ClubInvalidSettingsException(requestId);
  }
}

function buildClubSettingsUpdateData(dto: UpdateMyClubSettingsDto): Partial<Record<UpdateFieldName, string>> {
  return {
    shortName: normalizeUpdateString(dto.shortName),
    primaryColor: normalizeColor(dto.primaryColor),
    secondaryColor: normalizeColor(dto.secondaryColor)
  };
}

function normalizeUpdateString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
}

function normalizeColor(value: string | undefined): string | undefined {
  const normalizedValue = normalizeUpdateString(value);

  return normalizedValue?.toUpperCase();
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

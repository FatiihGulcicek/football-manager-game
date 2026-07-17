import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ClubListQueryDto {
  @Transform(({ value }) => normalizeOptionalString(value, 80))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @Transform(({ value }) => normalizeUppercaseString(value, 2))
  @IsOptional()
  @IsString()
  @Matches(COUNTRY_CODE_PATTERN)
  countryCode?: string;

  @Transform(({ value }) => normalizeOptionalInteger(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(({ value }) => normalizeOptionalInteger(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class UpdateMyClubSettingsDto {
  @Transform(({ value }) => normalizeOptionalString(value, 30))
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  shortName?: string;

  @Transform(({ value }) => normalizeHexColor(value))
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_PATTERN)
  primaryColor?: string;

  @Transform(({ value }) => normalizeHexColor(value))
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_PATTERN)
  secondaryColor?: string;
}

export type ClubPublicSummaryDto = {
  slug: string;
  name: string;
  shortName: string;
  threeLetterCode: string | null;
  primaryColor: string;
  secondaryColor: string;
  logoAssetKey: string | null;
  countryCode: string;
  city: string;
  reputation: number;
  fanBase: number;
  foundedYear: number | null;
  stadiumName: string;
  stadiumCapacity: number;
};

export type ClubPublicDetailDto = ClubPublicSummaryDto & {
  status: 'ACTIVE';
  managerDisplayName: string | null;
  divisionLevel: number | null;
  boardExpectation: string;
};

export type ClubPrivateDto = ClubPublicDetailDto & {
  id: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  currentManagerProfileId: string;
  managerAssignedAt: string | null;
  balance: string;
  transferBudget: string;
  wageBudget: string;
  currencyCode: string;
  trainingFacilityLevel: number;
  youthFacilityLevel: number;
  currentLeagueId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClubListResponseDto = {
  items: ClubPublicSummaryDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type ClubSettingsUpdateResultDto = {
  club: ClubPrivateDto;
  changedFields: string[];
};

export function assertValidClubSlug(slug: string): string {
  const normalizedSlug = slug.trim().toLowerCase();

  if (!SLUG_PATTERN.test(normalizedSlug) || normalizedSlug.length > 80) {
    throw new Error('invalid_slug');
  }

  return normalizedSlug;
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value as string;
  }

  const normalizedValue = Array.from(value.trim()).slice(0, maxLength).join('');

  return normalizedValue || undefined;
}

function normalizeUppercaseString(value: unknown, maxLength: number): string | undefined {
  const normalizedValue = normalizeOptionalString(value, maxLength);

  return normalizedValue?.toUpperCase();
}

function normalizeHexColor(value: unknown): string | undefined {
  const normalizedValue = normalizeOptionalString(value, 7);

  return normalizedValue?.toUpperCase();
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return Number.NaN;
  }

  return Number(value);
}

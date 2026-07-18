import { Body, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { resolveClientIp } from '../../http/client-ip.util';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { createRequestId } from '../../auth/http/auth-request.util';
import { AuthenticatedHttpRequest, AuthenticatedUser } from '../../auth/types/authenticated-user';
import {
  ClubListQueryDto,
  ClubListResponseDto,
  ClubPrivateDto,
  ClubPublicDetailDto,
  ClubSettingsUpdateResultDto,
  UpdateMyClubSettingsDto
} from '../dto/club.dto';
import { ClubService } from '../services/club.service';

const CLUB_LIST_QUERY_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  expectedType: ClubListQueryDto
});
const CLUB_SETTINGS_BODY_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  expectedType: UpdateMyClubSettingsDto
});

@Controller('clubs')
export class ClubsController {
  constructor(
    @Inject(ClubService)
    private readonly clubService: ClubService,
    @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig
  ) {}

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async getMyClub(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedHttpRequest
  ): Promise<ClubPrivateDto> {
    return this.clubService.getMyClub(user, createClubRequestContext(request, this.config));
  }

  @Get()
  async listPublicClubs(
    @Query(CLUB_LIST_QUERY_PIPE) query: ClubListQueryDto,
    @Req() request: AuthenticatedHttpRequest
  ): Promise<ClubListResponseDto> {
    return this.clubService.listPublicClubs(query, createClubRequestContext(request, this.config));
  }

  @Get(':slug')
  async getPublicClubBySlug(
    @Param('slug') slug: string,
    @Req() request: AuthenticatedHttpRequest
  ): Promise<ClubPublicDetailDto> {
    return this.clubService.getPublicClubBySlug(slug, createClubRequestContext(request, this.config));
  }

  @Patch('me')
  @UseGuards(AccessTokenGuard)
  async updateMyClubSettings(
    @Body(CLUB_SETTINGS_BODY_PIPE) dto: UpdateMyClubSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedHttpRequest
  ): Promise<ClubSettingsUpdateResultDto> {
    return this.clubService.updateMyClubSettings(user, dto, createClubRequestContext(request, this.config));
  }
}

function createClubRequestContext(request: AuthenticatedHttpRequest, config: AuthConfig) {
  return {
    requestId: createRequestId(request),
    clientIp: resolveClientIp(request, config)
  };
}

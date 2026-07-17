import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

export const CLUB_ERROR_CODES = {
  NOT_FOUND: 'CLUB_NOT_FOUND',
  NOT_ASSIGNED: 'CLUB_NOT_ASSIGNED',
  ACCESS_DENIED: 'CLUB_ACCESS_DENIED',
  INVALID_SETTINGS: 'CLUB_INVALID_SETTINGS'
} as const;

export class ClubNotFoundException extends NotFoundException {
  constructor(requestId: string) {
    super(createClubError(CLUB_ERROR_CODES.NOT_FOUND, 'Kulup bulunamadi.', requestId));
  }
}

export class ClubNotAssignedException extends NotFoundException {
  constructor(requestId: string) {
    super(createClubError(CLUB_ERROR_CODES.NOT_ASSIGNED, 'Yonetilen kulup bulunamadi.', requestId));
  }
}

export class ClubAccessDeniedException extends ForbiddenException {
  constructor(requestId: string) {
    super(createClubError(CLUB_ERROR_CODES.ACCESS_DENIED, 'Kulup erisimi reddedildi.', requestId));
  }
}

export class ClubInvalidSettingsException extends BadRequestException {
  constructor(requestId: string) {
    super(createClubError(CLUB_ERROR_CODES.INVALID_SETTINGS, 'Kulup ayarlari gecersiz.', requestId));
  }
}

function createClubError(code: string, message: string, requestId: string) {
  return {
    error: {
      code,
      message,
      requestId
    }
  };
}

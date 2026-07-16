export type SessionResponseDto = {
  id: string;
  deviceName: string | null;
  deviceType: string | null;
  browser: string | null;
  operatingSystem: string | null;
  countryCode: string | null;
  city: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

export type SessionsResponseDto = {
  sessions: SessionResponseDto[];
};

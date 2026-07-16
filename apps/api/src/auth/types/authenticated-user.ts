import { UserRole } from '@football-manager/database';

export type AuthenticatedUser = {
  userId: string;
  role: UserRole;
  sessionId: string;
};

export type AuthenticatedHttpRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
  ip?: string;
  authenticatedUser?: AuthenticatedUser;
};

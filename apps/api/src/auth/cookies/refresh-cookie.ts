import { AuthConfig } from '../../config/auth.config';

export type RefreshCookieResponse = {
  cookie: (name: string, value: string, options: SetRefreshCookieOptions) => void;
  clearCookie: (name: string, options: ClearRefreshCookieOptions) => void;
};

export type SetRefreshCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: AuthConfig['cookieSameSite'];
  path: string;
  maxAge: number;
  domain?: string;
};

export type ClearRefreshCookieOptions = Omit<SetRefreshCookieOptions, 'maxAge'>;

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;
  const cookie = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));

  if (!cookie) {
    return undefined;
  }

  return safeDecodeCookieValue(cookie.slice(prefix.length));
}

export function setRefreshCookie(
  response: RefreshCookieResponse,
  config: AuthConfig,
  refreshToken: string
): void {
  response.cookie(config.cookieName, refreshToken, {
    ...createBaseRefreshCookieOptions(config),
    maxAge: config.refreshTokenTtlSeconds * 1000
  });
}

export function clearRefreshCookie(response: RefreshCookieResponse, config: AuthConfig): void {
  response.clearCookie(config.cookieName, createBaseRefreshCookieOptions(config));
}

function createBaseRefreshCookieOptions(config: AuthConfig): ClearRefreshCookieOptions {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: config.cookiePath,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {})
  };
}

function safeDecodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

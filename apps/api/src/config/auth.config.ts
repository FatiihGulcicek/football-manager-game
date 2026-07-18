import { loadAuthConfig } from './auth-config.schema';

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export const authConfig = loadAuthConfig();

export type {
  AuthConfig,
  AuthCookieSameSite,
  AuthRateLimitRule,
  AuthRateLimitsConfig
} from './auth-config.schema';
export { DEFAULT_AUTH_RATE_LIMITS } from './auth-config.schema';

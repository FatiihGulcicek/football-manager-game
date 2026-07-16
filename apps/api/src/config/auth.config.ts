import { loadAuthConfig } from './auth-config.schema';

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export const authConfig = loadAuthConfig();

export type { AuthConfig, AuthCookieSameSite } from './auth-config.schema';

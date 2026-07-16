import { loadAuthConfig } from './auth-config.schema';

export const authConfig = loadAuthConfig();

export type { AuthConfig, AuthCookieSameSite } from './auth-config.schema';

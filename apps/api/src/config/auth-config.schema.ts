import { generateKeyPairSync, randomBytes } from 'crypto';

export type AuthCookieSameSite = 'lax' | 'strict' | 'none';

export type AuthRateLimitRule = {
  limit: number;
  windowSeconds: number;
};

export type AuthRateLimitsConfig = {
  register: {
    ip: AuthRateLimitRule;
    email: AuthRateLimitRule;
  };
  login: {
    ip: AuthRateLimitRule;
    account: AuthRateLimitRule;
    ipAccount: AuthRateLimitRule;
  };
  refresh: {
    ip: AuthRateLimitRule;
    session: AuthRateLimitRule;
  };
  forgotPassword: {
    ip: AuthRateLimitRule;
    account: AuthRateLimitRule;
  };
  resetPassword: {
    ip: AuthRateLimitRule;
    token: AuthRateLimitRule;
  };
  resendVerification: {
    ip: AuthRateLimitRule;
    account: AuthRateLimitRule;
  };
  verifyEmail: {
    ip: AuthRateLimitRule;
    token: AuthRateLimitRule;
  };
};

export type AuthConfig = {
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  emailVerifyTtlSeconds: number;
  passwordResetTtlSeconds: number;
  refreshGraceSeconds: number;
  jwtIssuer: string;
  jwtAudience: string;
  jwtActiveKid: string;
  jwtPrivateKey: string;
  jwtPublicKeys: Record<string, string>;
  tokenPepper: string;
  cookieName: string;
  cookieSecure: boolean;
  cookieSameSite: AuthCookieSameSite;
  cookieDomain?: string;
  cookiePath: string;
  trustProxyHops?: number;
  trustProxyCidrs: string[];
  rateLimits?: AuthRateLimitsConfig;
  argon2MemoryCost: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
};

type Environment = Record<string, string | undefined>;

const MAX_RATE_LIMIT = 100_000;
const MAX_RATE_LIMIT_WINDOW_SECONDS = 86_400;
const DEVELOPMENT_KID = 'development';
const LEGACY_DEV_PRIVATE_KEY_PLACEHOLDER = 'development-only-private-key-placeholder';
const LEGACY_DEV_PUBLIC_KEY_PLACEHOLDER = 'development-only-public-key-placeholder';
const LEGACY_DEV_TOKEN_PEPPER_PLACEHOLDER = 'development-only-token-pepper';

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimitsConfig = {
  register: {
    ip: { limit: 10, windowSeconds: 3_600 },
    email: { limit: 5, windowSeconds: 3_600 }
  },
  login: {
    ip: { limit: 30, windowSeconds: 900 },
    account: { limit: 10, windowSeconds: 900 },
    ipAccount: { limit: 5, windowSeconds: 900 }
  },
  refresh: {
    ip: { limit: 120, windowSeconds: 900 },
    session: { limit: 60, windowSeconds: 900 }
  },
  forgotPassword: {
    ip: { limit: 10, windowSeconds: 3_600 },
    account: { limit: 3, windowSeconds: 3_600 }
  },
  resetPassword: {
    ip: { limit: 20, windowSeconds: 3_600 },
    token: { limit: 5, windowSeconds: 900 }
  },
  resendVerification: {
    ip: { limit: 10, windowSeconds: 3_600 },
    account: { limit: 3, windowSeconds: 3_600 }
  },
  verifyEmail: {
    ip: { limit: 30, windowSeconds: 3_600 },
    token: { limit: 5, windowSeconds: 900 }
  }
};

let developmentDefaults: {
  jwtPrivateKey: string;
  jwtPublicKeys: Record<string, string>;
  tokenPepper: string;
} | null = null;

export function loadAuthConfig(env: Environment = process.env): AuthConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const devDefaults = isProduction ? undefined : getDevelopmentDefaults();

  const config: AuthConfig = {
    accessTokenTtlSeconds: readPositiveInteger(env, 'AUTH_ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTokenTtlSeconds: readPositiveInteger(env, 'AUTH_REFRESH_TOKEN_TTL_SECONDS', 2_592_000),
    emailVerifyTtlSeconds: readPositiveInteger(env, 'AUTH_EMAIL_VERIFY_TTL_SECONDS', 86_400),
    passwordResetTtlSeconds: readPositiveInteger(env, 'AUTH_PASSWORD_RESET_TTL_SECONDS', 1_800),
    refreshGraceSeconds: readNonNegativeInteger(env, 'AUTH_REFRESH_GRACE_SECONDS', 5),
    jwtIssuer: readString(env, 'JWT_ISSUER', 'football-manager-auth'),
    jwtAudience: readString(env, 'JWT_AUDIENCE', 'football-manager-api'),
    jwtActiveKid: readString(env, 'JWT_ACTIVE_KID', isProduction ? undefined : DEVELOPMENT_KID),
    jwtPrivateKey: readString(env, 'JWT_PRIVATE_KEY', isProduction ? undefined : devDefaults?.jwtPrivateKey),
    jwtPublicKeys: readJsonObject(
      env,
      'JWT_PUBLIC_KEYS_JSON',
      isProduction ? undefined : devDefaults?.jwtPublicKeys
    ),
    tokenPepper: readString(env, 'AUTH_TOKEN_PEPPER', isProduction ? undefined : devDefaults?.tokenPepper),
    cookieName: readString(env, 'AUTH_COOKIE_NAME', isProduction ? undefined : 'refresh_token'),
    cookieSecure: readBoolean(env, 'AUTH_COOKIE_SECURE', isProduction),
    cookieSameSite: readSameSite(env, 'AUTH_COOKIE_SAME_SITE', 'lax'),
    cookieDomain: readOptionalString(env, 'AUTH_COOKIE_DOMAIN'),
    cookiePath: readString(env, 'AUTH_COOKIE_PATH', '/'),
    trustProxyHops: readOptionalInteger(env, 'TRUST_PROXY_HOPS'),
    trustProxyCidrs: readCsv(env, 'TRUST_PROXY_CIDRS'),
    rateLimits: readAuthRateLimits(env),
    argon2MemoryCost: readPositiveInteger(env, 'AUTH_ARGON2_MEMORY_COST', 65_536),
    argon2TimeCost: readPositiveInteger(env, 'AUTH_ARGON2_TIME_COST', 3),
    argon2Parallelism: readPositiveInteger(env, 'AUTH_ARGON2_PARALLELISM', 1)
  };

  validateAuthConfig(config, isProduction);

  return config;
}

export function validateAuthConfig(config: AuthConfig, isProduction: boolean): void {
  if (!config.jwtPublicKeys[config.jwtActiveKid]) {
    throw new Error('JWT_PUBLIC_KEYS_JSON must include JWT_ACTIVE_KID');
  }

  if (config.refreshGraceSeconds > 30) {
    throw new Error('AUTH_REFRESH_GRACE_SECONDS must be 30 seconds or less');
  }

  if (config.trustProxyHops !== undefined && config.trustProxyCidrs.length > 0) {
    throw new Error('Use either TRUST_PROXY_HOPS or TRUST_PROXY_CIDRS, not both');
  }

  validateAuthRateLimits(config.rateLimits ?? DEFAULT_AUTH_RATE_LIMITS);

  if (!isProduction) {
    return;
  }

  if (config.cookieName !== '__Host-refresh_token') {
    throw new Error('AUTH_COOKIE_NAME must be __Host-refresh_token in production');
  }

  if (!config.cookieSecure) {
    throw new Error('AUTH_COOKIE_SECURE must be true in production');
  }

  if (config.cookieDomain) {
    throw new Error('AUTH_COOKIE_DOMAIN must be empty for __Host- cookies in production');
  }

  if (config.cookiePath !== '/') {
    throw new Error('AUTH_COOKIE_PATH must be / in production');
  }

  if (config.cookieSameSite !== 'lax') {
    throw new Error('AUTH_COOKIE_SAME_SITE must be Lax in production');
  }

  if (config.jwtPrivateKey === LEGACY_DEV_PRIVATE_KEY_PLACEHOLDER) {
    throw new Error('JWT_PRIVATE_KEY must be configured in production');
  }

  if (Object.values(config.jwtPublicKeys).includes(LEGACY_DEV_PUBLIC_KEY_PLACEHOLDER)) {
    throw new Error('JWT_PUBLIC_KEYS_JSON must be configured in production');
  }

  if (config.tokenPepper === LEGACY_DEV_TOKEN_PEPPER_PLACEHOLDER) {
    throw new Error('AUTH_TOKEN_PEPPER must be configured in production');
  }
}

function getDevelopmentDefaults(): {
  jwtPrivateKey: string;
  jwtPublicKeys: Record<string, string>;
  tokenPepper: string;
} {
  if (!developmentDefaults) {
    const keyPair = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      },
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      }
    });

    developmentDefaults = {
      jwtPrivateKey: keyPair.privateKey,
      jwtPublicKeys: {
        [DEVELOPMENT_KID]: keyPair.publicKey
      },
      tokenPepper: randomBytes(32).toString('base64url')
    };
  }

  return developmentDefaults;
}

function readString(env: Environment, key: string, fallback?: string): string {
  const value = env[key]?.trim() || fallback;

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function readOptionalString(env: Environment, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function readPositiveInteger(env: Environment, key: string, fallback: number): number {
  const value = readInteger(env, key, fallback);

  if (value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

function readNonNegativeInteger(env: Environment, key: string, fallback: number): number {
  const value = readInteger(env, key, fallback);

  if (value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }

  return value;
}

function readOptionalInteger(env: Environment, key: string): number | undefined {
  const value = env[key]?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }

  return parsed;
}

function readBoundedPositiveInteger(
  env: Environment,
  key: string,
  fallback: number,
  max: number
): number {
  const value = readPositiveInteger(env, key, fallback);

  if (value > max) {
    throw new Error(`${key} must be ${max} or less`);
  }

  return value;
}

function readAuthRateLimits(env: Environment): AuthRateLimitsConfig {
  return {
    register: {
      ip: readRateLimitRule(env, 'AUTH_RATE_LIMIT_REGISTER_IP', DEFAULT_AUTH_RATE_LIMITS.register.ip),
      email: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_REGISTER_EMAIL',
        DEFAULT_AUTH_RATE_LIMITS.register.email
      )
    },
    login: {
      ip: readRateLimitRule(env, 'AUTH_RATE_LIMIT_LOGIN_IP', DEFAULT_AUTH_RATE_LIMITS.login.ip),
      account: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_LOGIN_ACCOUNT',
        DEFAULT_AUTH_RATE_LIMITS.login.account
      ),
      ipAccount: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_LOGIN_IP_ACCOUNT',
        DEFAULT_AUTH_RATE_LIMITS.login.ipAccount
      )
    },
    refresh: {
      ip: readRateLimitRule(env, 'AUTH_RATE_LIMIT_REFRESH_IP', DEFAULT_AUTH_RATE_LIMITS.refresh.ip),
      session: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_REFRESH_SESSION',
        DEFAULT_AUTH_RATE_LIMITS.refresh.session
      )
    },
    forgotPassword: {
      ip: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_FORGOT_PASSWORD_IP',
        DEFAULT_AUTH_RATE_LIMITS.forgotPassword.ip
      ),
      account: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_FORGOT_PASSWORD_ACCOUNT',
        DEFAULT_AUTH_RATE_LIMITS.forgotPassword.account
      )
    },
    resetPassword: {
      ip: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_RESET_PASSWORD_IP',
        DEFAULT_AUTH_RATE_LIMITS.resetPassword.ip
      ),
      token: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_RESET_PASSWORD_TOKEN',
        DEFAULT_AUTH_RATE_LIMITS.resetPassword.token
      )
    },
    resendVerification: {
      ip: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_RESEND_VERIFICATION_IP',
        DEFAULT_AUTH_RATE_LIMITS.resendVerification.ip
      ),
      account: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_RESEND_VERIFICATION_ACCOUNT',
        DEFAULT_AUTH_RATE_LIMITS.resendVerification.account
      )
    },
    verifyEmail: {
      ip: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_VERIFY_EMAIL_IP',
        DEFAULT_AUTH_RATE_LIMITS.verifyEmail.ip
      ),
      token: readRateLimitRule(
        env,
        'AUTH_RATE_LIMIT_VERIFY_EMAIL_TOKEN',
        DEFAULT_AUTH_RATE_LIMITS.verifyEmail.token
      )
    }
  };
}

function readRateLimitRule(
  env: Environment,
  keyPrefix: string,
  fallback: AuthRateLimitRule
): AuthRateLimitRule {
  return {
    limit: readBoundedPositiveInteger(env, `${keyPrefix}_LIMIT`, fallback.limit, MAX_RATE_LIMIT),
    windowSeconds: readBoundedPositiveInteger(
      env,
      `${keyPrefix}_WINDOW_SECONDS`,
      fallback.windowSeconds,
      MAX_RATE_LIMIT_WINDOW_SECONDS
    )
  };
}

function validateAuthRateLimits(rateLimits: AuthRateLimitsConfig): void {
  for (const [path, rule] of collectRateLimitRules(rateLimits)) {
    if (!Number.isInteger(rule.limit) || rule.limit <= 0 || rule.limit > MAX_RATE_LIMIT) {
      throw new Error(`${path}.limit must be an integer between 1 and ${MAX_RATE_LIMIT}`);
    }

    if (
      !Number.isInteger(rule.windowSeconds) ||
      rule.windowSeconds <= 0 ||
      rule.windowSeconds > MAX_RATE_LIMIT_WINDOW_SECONDS
    ) {
      throw new Error(
        `${path}.windowSeconds must be an integer between 1 and ${MAX_RATE_LIMIT_WINDOW_SECONDS}`
      );
    }
  }
}

function collectRateLimitRules(rateLimits: AuthRateLimitsConfig): Array<[string, AuthRateLimitRule]> {
  return [
    ['rateLimits.register.ip', rateLimits.register.ip],
    ['rateLimits.register.email', rateLimits.register.email],
    ['rateLimits.login.ip', rateLimits.login.ip],
    ['rateLimits.login.account', rateLimits.login.account],
    ['rateLimits.login.ipAccount', rateLimits.login.ipAccount],
    ['rateLimits.refresh.ip', rateLimits.refresh.ip],
    ['rateLimits.refresh.session', rateLimits.refresh.session],
    ['rateLimits.forgotPassword.ip', rateLimits.forgotPassword.ip],
    ['rateLimits.forgotPassword.account', rateLimits.forgotPassword.account],
    ['rateLimits.resetPassword.ip', rateLimits.resetPassword.ip],
    ['rateLimits.resetPassword.token', rateLimits.resetPassword.token],
    ['rateLimits.resendVerification.ip', rateLimits.resendVerification.ip],
    ['rateLimits.resendVerification.account', rateLimits.resendVerification.account],
    ['rateLimits.verifyEmail.ip', rateLimits.verifyEmail.ip],
    ['rateLimits.verifyEmail.token', rateLimits.verifyEmail.token]
  ];
}

function readInteger(env: Environment, key: string, fallback: number): number {
  const value = env[key]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${key} must be an integer`);
  }

  return parsed;
}

function readBoolean(env: Environment, key: string, fallback: boolean): boolean {
  const value = env[key]?.trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`${key} must be true or false`);
}

function readSameSite(env: Environment, key: string, fallback: AuthCookieSameSite): AuthCookieSameSite {
  const value = env[key]?.trim().toLowerCase() ?? fallback;

  if (value === 'lax' || value === 'strict' || value === 'none') {
    return value;
  }

  throw new Error(`${key} must be Lax, Strict, or None`);
}

function readCsv(env: Environment, key: string): string[] {
  return (
    env[key]
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? []
  );
}

function readJsonObject(
  env: Environment,
  key: string,
  fallback?: Record<string, string>
): Record<string, string> {
  const value = env[key]?.trim();

  if (!value) {
    if (fallback) {
      return fallback;
    }

    throw new Error(`${key} is required`);
  }

  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${key} must be a JSON object`);
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([entryKey, entryValue]) => {
      if (typeof entryValue !== 'string' || entryValue.trim().length === 0) {
        throw new Error(`${key} values must be non-empty strings`);
      }

      return [entryKey, entryValue];
    })
  );
}

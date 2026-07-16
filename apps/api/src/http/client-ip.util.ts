import { AuthConfig } from '../config/auth.config';

type ClientIpRequest = {
  socket?: {
    remoteAddress?: string;
  };
  ip?: string;
};

type ClientIpConfig = Pick<AuthConfig, 'trustProxyHops' | 'trustProxyCidrs'>;

export function resolveClientIp(request: ClientIpRequest, config: ClientIpConfig): string {
  const candidate = isTrustProxyEnabled(config)
    ? request.ip ?? request.socket?.remoteAddress
    : request.socket?.remoteAddress ?? request.ip;

  return normalizeClientIp(candidate);
}

export function normalizeClientIp(value: string | undefined): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return 'unknown';
  }

  if (normalizedValue.startsWith('::ffff:')) {
    return normalizedValue.slice(7);
  }

  return normalizedValue;
}

function isTrustProxyEnabled(config: ClientIpConfig): boolean {
  return config.trustProxyHops !== undefined || config.trustProxyCidrs.length > 0;
}

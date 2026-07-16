import { INestApplication } from '@nestjs/common';
import { AuthConfig } from '../config/auth.config';

type TrustProxyConfig = Pick<AuthConfig, 'trustProxyHops' | 'trustProxyCidrs'>;
type TrustProxyValue = number | string[];

type ExpressLikeApplication = {
  set: (setting: string, value: TrustProxyValue) => void;
};

export function applyTrustProxy(app: INestApplication, config: TrustProxyConfig): void {
  const trustProxyValue = getTrustProxyValue(config);

  if (trustProxyValue === undefined) {
    return;
  }

  const express = app.getHttpAdapter().getInstance() as ExpressLikeApplication;
  express.set('trust proxy', trustProxyValue);
}

export function getTrustProxyValue(config: TrustProxyConfig): TrustProxyValue | undefined {
  if (config.trustProxyHops !== undefined) {
    return config.trustProxyHops;
  }

  if (config.trustProxyCidrs.length > 0) {
    return config.trustProxyCidrs;
  }

  return undefined;
}

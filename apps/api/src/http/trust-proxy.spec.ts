import { describe, expect, it, vi } from 'vitest';
import { applyTrustProxy, getTrustProxyValue } from './trust-proxy';

describe('trust proxy configuration', () => {
  it('should resolve hop count trust proxy values', () => {
    expect(getTrustProxyValue({ trustProxyHops: 1, trustProxyCidrs: [] })).toBe(1);
  });

  it('should resolve CIDR allowlist trust proxy values', () => {
    expect(getTrustProxyValue({ trustProxyCidrs: ['loopback', '10.0.0.0/8'] })).toEqual([
      'loopback',
      '10.0.0.0/8'
    ]);
  });

  it('should leave trust proxy disabled when no proxy config exists', () => {
    expect(getTrustProxyValue({ trustProxyCidrs: [] })).toBeUndefined();
  });

  it('should set Express trust proxy to a hop count during bootstrap', () => {
    const set = vi.fn();

    applyTrustProxy(createNestApp(set), {
      trustProxyHops: 2,
      trustProxyCidrs: []
    });

    expect(set).toHaveBeenCalledWith('trust proxy', 2);
  });

  it('should set Express trust proxy to a CIDR allowlist during bootstrap', () => {
    const set = vi.fn();

    applyTrustProxy(createNestApp(set), {
      trustProxyCidrs: ['loopback']
    });

    expect(set).toHaveBeenCalledWith('trust proxy', ['loopback']);
  });

  it('should not set Express trust proxy when proxy config is empty', () => {
    const set = vi.fn();

    applyTrustProxy(createNestApp(set), {
      trustProxyCidrs: []
    });

    expect(set).not.toHaveBeenCalled();
  });
});

function createNestApp(set: (setting: string, value: number | string[]) => void): Parameters<
  typeof applyTrustProxy
>[0] {
  return {
    getHttpAdapter: () => ({
      getInstance: () => ({
        set
      })
    })
  } as Parameters<typeof applyTrustProxy>[0];
}

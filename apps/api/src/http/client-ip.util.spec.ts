import { describe, expect, it } from 'vitest';
import { resolveClientIp } from './client-ip.util';

const noTrustProxyConfig = {
  trustProxyCidrs: []
};

describe('resolveClientIp', () => {
  it('should ignore spoofed X-Forwarded-For when trust proxy is disabled', () => {
    const clientIp = resolveClientIp(
      {
        ip: '203.0.113.10',
        socket: {
          remoteAddress: '::ffff:127.0.0.1'
        }
      },
      noTrustProxyConfig
    );

    expect(clientIp).toBe('127.0.0.1');
  });

  it('should use Express request.ip after trusted proxy hop resolution', () => {
    const clientIp = resolveClientIp(
      {
        ip: '198.51.100.25',
        socket: {
          remoteAddress: '127.0.0.1'
        }
      },
      {
        trustProxyHops: 1,
        trustProxyCidrs: []
      }
    );

    expect(clientIp).toBe('198.51.100.25');
  });

  it('should use Express request.ip after trusted CIDR resolution', () => {
    const clientIp = resolveClientIp(
      {
        ip: '198.51.100.50',
        socket: {
          remoteAddress: '127.0.0.1'
        }
      },
      {
        trustProxyCidrs: ['loopback']
      }
    );

    expect(clientIp).toBe('198.51.100.50');
  });

  it('should normalize IPv4-mapped IPv6 addresses', () => {
    const clientIp = resolveClientIp(
      {
        socket: {
          remoteAddress: '::ffff:192.0.2.1'
        }
      },
      noTrustProxyConfig
    );

    expect(clientIp).toBe('192.0.2.1');
  });
});

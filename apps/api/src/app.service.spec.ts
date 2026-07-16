import { describe, expect, it, vi } from 'vitest';

import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';

describe('AppService', () => {
  function createService(options?: {
    database?: () => Promise<unknown>;
    redis?: () => Promise<unknown>;
  }) {
    const prismaService = {
      healthCheck: vi.fn(options?.database ?? (async () => 'up'))
    } as unknown as PrismaService;
    const redisService = {
      ping: vi.fn(options?.redis ?? (async () => 'up'))
    } as unknown as RedisService;

    return new AppService(prismaService, redisService);
  }

  it('should return API status', () => {
    const service = createService();
    expect(service.getStatus()).toEqual({ status: 'ok', service: 'football-manager-api' });
  });

  it('should return ok health when database and Redis are up', async () => {
    const service = createService();

    await expect(service.getHealth()).resolves.toMatchObject({
      status: 'ok',
      service: 'football-manager-api',
      dependencies: {
        database: 'up',
        redis: 'up'
      }
    });
  });

  it('should return a safe degraded health when database is down', async () => {
    const service = createService({
      database: async () => {
        throw new Error('postgres://secret-password');
      }
    });

    const health = await service.getHealth();

    expect(health).toMatchObject({
      status: 'degraded',
      dependencies: {
        database: 'down',
        redis: 'up'
      }
    });
    expect(JSON.stringify(health)).not.toContain('secret-password');
  });

  it('should return a safe degraded health when Redis is down', async () => {
    const service = createService({
      redis: async () => {
        throw new Error('redis://secret-password');
      }
    });

    const health = await service.getHealth();

    expect(health).toMatchObject({
      status: 'degraded',
      dependencies: {
        database: 'up',
        redis: 'down'
      }
    });
    expect(JSON.stringify(health)).not.toContain('secret-password');
  });
});

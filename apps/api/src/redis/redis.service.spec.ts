import { describe, expect, it, vi } from 'vitest';
import { RedisClientLike, RedisService } from './redis.service';

describe('RedisService', () => {
  function createClient(overrides: Partial<RedisClientLike> = {}): RedisClientLike {
    return {
      status: 'ready',
      connect: vi.fn(async () => undefined),
      ping: vi.fn(async () => 'PONG'),
      quit: vi.fn(async () => undefined),
      ...overrides
    };
  }

  it('should return up when ping succeeds', async () => {
    const client = createClient();
    const service = new RedisService(client);

    await expect(service.ping()).resolves.toBe('up');
    expect(client.ping).toHaveBeenCalledOnce();
  });

  it('should connect lazily before ping when the client is waiting', async () => {
    const client = createClient({ status: 'wait' });
    const service = new RedisService(client);

    await service.ping();

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.ping).toHaveBeenCalledOnce();
  });

  it('should not swallow ping errors', async () => {
    const client = createClient({
      ping: vi.fn(async () => {
        throw new Error('redis unavailable');
      })
    });
    const service = new RedisService(client);

    await expect(service.ping()).rejects.toThrow('redis unavailable');
  });

  it('should quit the Redis connection on shutdown', async () => {
    const client = createClient();
    const service = new RedisService(client);

    await service.onModuleDestroy();

    expect(client.quit).toHaveBeenCalledOnce();
  });
});

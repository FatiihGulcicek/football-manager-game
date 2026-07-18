import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(new PrismaService()).toBeInstanceOf(PrismaService);
  });

  it('should connect and disconnect during lifecycle hooks', async () => {
    const service = new PrismaService();
    const connect = vi.spyOn(service, '$connect').mockResolvedValue(undefined);
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('should not swallow connection errors', async () => {
    const service = new PrismaService();
    vi.spyOn(service, '$connect').mockRejectedValue(new Error('connect failed'));

    await expect(service.onModuleInit()).rejects.toThrow('connect failed');
  });
});

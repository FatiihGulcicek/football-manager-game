import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type RedisClientLike = {
  status?: string;
  connect?: () => Promise<void>;
  ping: () => Promise<string>;
  quit: () => Promise<unknown>;
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClientLike) {}

  async ping(): Promise<'up'> {
    if (this.client.status === 'wait' && this.client.connect) {
      await this.client.connect();
    }

    const response = await this.client.ping();

    if (response !== 'PONG') {
      throw new Error('Unexpected Redis ping response');
    }

    return 'up';
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type RedisClientLike = {
  status?: string;
  connect?: () => Promise<void>;
  ping: () => Promise<string>;
  eval?: (
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ) => Promise<unknown>;
  quit: () => Promise<unknown>;
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClientLike) {}

  async ping(): Promise<'up'> {
    await this.connectIfWaiting();

    const response = await this.client.ping();

    if (response !== 'PONG') {
      throw new Error('Unexpected Redis ping response');
    }

    return 'up';
  }

  async eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    await this.connectIfWaiting();

    if (!this.client.eval) {
      throw new Error('Redis client does not support EVAL');
    }

    return this.client.eval(script, numberOfKeys, ...args);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  private async connectIfWaiting(): Promise<void> {
    if (this.client.status === 'wait' && this.client.connect) {
      await this.client.connect();
    }
  }
}

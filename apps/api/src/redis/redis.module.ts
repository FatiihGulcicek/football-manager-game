import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () =>
        new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
          connectTimeout: 1000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null
        })
    },
    RedisService
  ],
  exports: [RedisService]
})
export class RedisModule {}

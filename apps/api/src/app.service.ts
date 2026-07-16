import { Injectable } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';

type HealthStatus = 'ok' | 'degraded';
type DependencyStatus = 'up' | 'down';

export type HealthCheckResponse = {
  status: HealthStatus;
  service: 'football-manager-api';
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
  timestamp: string;
};

const HEALTH_CHECK_TIMEOUT_MS = 1000;

@Injectable()
export class AppService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService
  ) {}

  getStatus() {
    return { status: 'ok', service: 'football-manager-api' };
  }

  async getHealth(): Promise<HealthCheckResponse> {
    const [database, redis] = await Promise.all([
      this.checkDependency(() => this.prismaService.healthCheck()),
      this.checkDependency(() => this.redisService.ping())
    ]);

    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'degraded',
      service: 'football-manager-api',
      dependencies: {
        database,
        redis
      },
      timestamp: new Date().toISOString()
    };
  }

  private async checkDependency(check: () => Promise<unknown>): Promise<DependencyStatus> {
    try {
      await this.withTimeout(check(), HEALTH_CHECK_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Health check timed out')), timeoutMs);
        })
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

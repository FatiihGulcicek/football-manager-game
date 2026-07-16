import { describe, expect, it } from 'vitest';

import { AppService } from './app.service';

describe('AppService', () => {
  it('should return health status', () => {
    const service = new AppService();
    expect(service.getStatus()).toEqual({ status: 'ok', message: 'Football Manager API with NestJS' });
  });
});

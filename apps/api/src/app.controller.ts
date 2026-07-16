import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { AppService } from './app.service';

type ResponseWithStatus = {
  status: (statusCode: number) => unknown;
};

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getStatus() {
    return this.appService.getStatus();
  }

  @Get('health')
  async getHealth(@Res({ passthrough: true }) response: ResponseWithStatus) {
    const health = await this.appService.getHealth();

    if (health.status !== 'ok') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return health;
  }
}

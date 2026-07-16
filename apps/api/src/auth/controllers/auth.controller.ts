import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { RegisterDto, RegisterResponseDto } from '../dto/register.dto';
import { RegisterService } from '../services/register.service';

@Controller('auth')
export class AuthController {
  constructor(@Inject(RegisterService) private readonly registerService: RegisterService) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.registerService.register(dto);
  }
}

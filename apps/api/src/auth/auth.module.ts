import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AccessTokenService } from './services/access-token.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { SessionService } from './services/session.service';
import { TokenHashService } from './services/token-hash.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    PasswordService,
    TokenHashService,
    AccessTokenService,
    SessionService,
    RefreshTokenService
  ],
  exports: [
    PasswordService,
    TokenHashService,
    AccessTokenService,
    SessionService,
    RefreshTokenService
  ]
})
export class AuthModule {}

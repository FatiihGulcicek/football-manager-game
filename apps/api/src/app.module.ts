import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ClubsModule } from './clubs/clubs.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [DatabaseModule, RedisModule, AuthModule, ClubsModule],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}

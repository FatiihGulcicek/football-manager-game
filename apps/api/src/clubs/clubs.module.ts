import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ClubsController } from './controllers/clubs.controller';
import { ClubService } from './services/club.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ClubsController],
  providers: [ClubService],
  exports: [ClubService]
})
export class ClubsModule {}

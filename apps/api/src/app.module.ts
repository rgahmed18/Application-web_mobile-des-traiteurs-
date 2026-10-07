import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/app-config.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [HealthController],
})
export class AppModule {}

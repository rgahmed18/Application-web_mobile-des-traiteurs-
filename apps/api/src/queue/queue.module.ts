import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfigService } from '../config/app-config.module';
import { parseRedisUrl } from '../redis/redis-url';

/** Files de traitements asynchrones (notifications, PDF, WhatsApp... à venir). */
export const NOTIFICATIONS_QUEUE = 'notifications';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: parseRedisUrl(config.get('REDIS_URL', { infer: true })),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      }),
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}

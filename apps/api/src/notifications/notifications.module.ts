import { Global, Module } from '@nestjs/common';

import { QueueModule } from '../queue/queue.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Notifications du traiteur (cloche), utilisées par les modules qui produisent les événements. */
@Global()
@Module({
  imports: [QueueModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

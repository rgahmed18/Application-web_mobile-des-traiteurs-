import { Module } from '@nestjs/common';

import { CalendarController, DashboardController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Commandes (cycle de vie, lignes, disponibilité), calendrier et tableau de bord. */
@Module({
  controllers: [OrdersController, CalendarController, DashboardController],
  providers: [OrdersService, CalendarService],
})
export class OrdersModule {}

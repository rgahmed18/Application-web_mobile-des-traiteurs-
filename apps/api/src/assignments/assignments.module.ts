import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { AssignmentsController, MissionsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { MissionsService } from './missions.service';
import { ServiceDocumentsService } from './service-documents.service';

/** Affectations du personnel, planning, missions (équipe, livreur) et bons de service. */
@Module({
  imports: [OrdersModule],
  controllers: [AssignmentsController, MissionsController],
  providers: [AssignmentsService, MissionsService, ServiceDocumentsService],
})
export class AssignmentsModule {}

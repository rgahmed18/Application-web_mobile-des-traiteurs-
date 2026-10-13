import { Module } from '@nestjs/common';

import { AppModule } from './app.module';
import { JobsModule } from './jobs/jobs.module';

/** Processus worker : le code de l'API (mêmes services) et les tâches BullMQ, sans HTTP. */
@Module({ imports: [AppModule, JobsModule] })
export class WorkerModule {}

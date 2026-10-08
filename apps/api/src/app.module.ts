import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AccessModule } from './access/access.module';
import { FeatureGuard } from './access/guards/feature.guard';
import { JwtAuthGuard } from './access/guards/jwt-auth.guard';
import { PermissionsGuard } from './access/guards/permissions.guard';
import { RolesGuard } from './access/guards/roles.guard';
import { TenantGuard } from './access/guards/tenant.guard';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './config/app-config.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { SequencesModule } from './sequences/sequences.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AccessModule,
    AuditModule,
    SequencesModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guards globaux, exécutés dans cet ordre sur toutes les routes (sauf @Public) :
    // authentification → isolation traiteur → rôle → permissions → fonctionnalité de l'offre
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
})
export class AppModule {}

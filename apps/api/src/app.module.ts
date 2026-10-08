import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { AccessModule } from './access/access.module';
import { FeatureGuard } from './access/guards/feature.guard';
import { JwtAuthGuard } from './access/guards/jwt-auth.guard';
import { PermissionsGuard } from './access/guards/permissions.guard';
import { RolesGuard } from './access/guards/roles.guard';
import { TenantGuard } from './access/guards/tenant.guard';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { DocumentsModule } from './documents/documents.module';
import { AppConfigModule } from './config/app-config.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
import { REDIS_CLIENT, RedisModule } from './redis/redis.module';
import { SequencesModule } from './sequences/sequences.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    // Limiteur de débit : compteurs dans Redis (partagés entre instances, conservés au redémarrage)
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AccessModule,
    AuditModule,
    SequencesModule,
    DocumentsModule,
    StorageModule,
    AuthModule,
    CatalogModule,
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

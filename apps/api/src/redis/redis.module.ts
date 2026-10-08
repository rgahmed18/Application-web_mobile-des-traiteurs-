import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { AppConfigService } from '../config/app-config.module';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Ferme proprement la connexion Redis à l'arrêt de l'application. */
@Injectable()
class RedisShutdown implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: AppConfigService): Redis =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          // Le cache est facultatif : on ne bloque pas les requêtes si Redis est indisponible.
          maxRetriesPerRequest: 1,
          lazyConnect: false,
        }),
    },
    RedisShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

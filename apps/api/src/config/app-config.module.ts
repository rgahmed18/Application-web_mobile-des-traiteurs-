import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { validateEnv, type Env } from './env.schema';

/** Accès typé à la configuration : config.get('PORT', { infer: true }). */
export type AppConfigService = ConfigService<Env, true>;

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}

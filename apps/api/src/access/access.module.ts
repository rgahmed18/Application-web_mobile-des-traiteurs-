import { Global, Module } from '@nestjs/common';

import { FeaturesService } from './features.service';
import { PermissionsService } from './permissions.service';

@Global()
@Module({
  providers: [PermissionsService, FeaturesService],
  exports: [PermissionsService, FeaturesService],
})
export class AccessModule {}

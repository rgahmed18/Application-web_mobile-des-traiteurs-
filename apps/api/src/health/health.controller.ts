import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: "L'API est démarrée" })
  check(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

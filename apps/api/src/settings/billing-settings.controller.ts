import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type BillingSettings,
  type BillingSettingsInput,
  billingSettingsInputSchema,
  billingSettingsSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { BillingSettingsService } from './billing-settings.service';

const response = { schema: zodToOpenApi(billingSettingsSchema, 'output') };

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/billing')
export class BillingSettingsController {
  constructor(private readonly settings: BillingSettingsService) {}

  @Get()
  @RequirePermissions('settings.manage')
  @ApiOkResponse(response)
  get(@CurrentUser() user: AuthenticatedUser): Promise<BillingSettings> {
    return this.settings.get(user);
  }

  @Put()
  @RequirePermissions('settings.manage')
  @ApiBody({ schema: zodToOpenApi(billingSettingsInputSchema) })
  @ApiOkResponse(response)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(billingSettingsInputSchema)) body: BillingSettingsInput,
    @Client() client: ClientInfo,
  ): Promise<BillingSettings> {
    return this.settings.update(user, body, client);
  }

  @Post('logo')
  @RequirePermissions('settings.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse(response)
  setLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Client() client: ClientInfo,
  ): Promise<BillingSettings> {
    return this.settings.setLogo(user, file, client);
  }

  @Delete('logo')
  @RequirePermissions('settings.manage')
  @ApiOkResponse(response)
  removeLogo(
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<BillingSettings> {
    return this.settings.removeLogo(user, client);
  }
}

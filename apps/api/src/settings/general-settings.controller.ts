import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Account,
  accountSchema,
  type AccountUpdateInput,
  accountUpdateSchema,
  type AvailabilitySettings,
  availabilitySettingsSchema,
  type CompanySettings,
  companySettingsSchema,
  type PasswordChangeInput,
  passwordChangeSchema,
  type PricingSettings,
  type PricingSettingsInput,
  pricingSettingsInputSchema,
  pricingSettingsSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Client, type ClientInfo } from '../common/http/client-info';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AccountService } from './account.service';
import { GeneralSettingsService } from './general-settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class GeneralSettingsController {
  constructor(private readonly settings: GeneralSettingsService) {}

  @Get('company')
  @RequirePermissions('settings.manage')
  @ApiOkResponse({ schema: zodToOpenApi(companySettingsSchema, 'output') })
  company(@CurrentUser() user: AuthenticatedUser): Promise<CompanySettings> {
    return this.settings.company(user);
  }

  @Put('company')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Entreprise : nom commercial, email, téléphone, ville' })
  @ApiBody({ schema: zodToOpenApi(companySettingsSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(companySettingsSchema, 'output') })
  updateCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(companySettingsSchema)) body: CompanySettings,
    @Client() client: ClientInfo,
  ): Promise<CompanySettings> {
    return this.settings.updateCompany(user, body, client);
  }

  @Get('availability')
  @RequirePermissions('settings.manage')
  @ApiOkResponse({ schema: zodToOpenApi(availabilitySettingsSchema, 'output') })
  availability(@CurrentUser() user: AuthenticatedUser): Promise<AvailabilitySettings> {
    return this.settings.availability(user);
  }

  @Put('availability')
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary: 'Disponibilités : capacité par jour, fermeture hebdomadaire, masquage des missions',
  })
  @ApiBody({ schema: zodToOpenApi(availabilitySettingsSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(availabilitySettingsSchema, 'output') })
  updateAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(availabilitySettingsSchema)) body: AvailabilitySettings,
    @Client() client: ClientInfo,
  ): Promise<AvailabilitySettings> {
    return this.settings.updateAvailability(user, body, client);
  }

  @Get('pricing')
  @RequirePermissions('settings.manage')
  @ApiOkResponse({ schema: zodToOpenApi(pricingSettingsSchema, 'output') })
  pricing(@CurrentUser() user: AuthenticatedUser): Promise<PricingSettings> {
    return this.settings.pricing(user);
  }

  @Put('pricing')
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary: 'Mode de saisie des prix (HT ou TTC) : les documents existants ne changent pas',
  })
  @ApiBody({ schema: zodToOpenApi(pricingSettingsInputSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(pricingSettingsSchema, 'output') })
  updatePricing(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(pricingSettingsInputSchema)) body: PricingSettingsInput,
    @Client() client: ClientInfo,
  ): Promise<PricingSettings> {
    return this.settings.updatePricing(user, body, client);
  }
}

/** Mon compte : accessible à tout utilisateur connecté, pour lui-même uniquement. */
@ApiTags('account')
@ApiBearerAuth()
@Controller('me/account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  @ApiOkResponse({ schema: zodToOpenApi(accountSchema, 'output') })
  get(@CurrentUser() user: AuthenticatedUser): Promise<Account> {
    return this.account.get(user);
  }

  @Put()
  @ApiOperation({ summary: 'Nom et langue de l’utilisateur connecté' })
  @ApiBody({ schema: zodToOpenApi(accountUpdateSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(accountSchema, 'output') })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(accountUpdateSchema)) body: AccountUpdateInput,
    @Client() client: ClientInfo,
  ): Promise<Account> {
    return this.account.update(user, body, client);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Nouveau mot de passe : toutes les sessions sont fermées' })
  @ApiBody({ schema: zodToOpenApi(passwordChangeSchema) })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(passwordChangeSchema)) body: PasswordChangeInput,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.account.changePassword(user, body, client);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type ClientAccount, clientAccountSchema } from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ClientAccountService } from './client-account.service';

/**
 * Espace du client sur le site du traiteur : toujours SA fiche chez CE traiteur (session), jamais
 * un identifiant venu de la requête.
 */
@ApiTags('client')
@ApiBearerAuth()
@Roles('CLIENT')
@Controller('client')
export class ClientSiteController {
  constructor(private readonly account: ClientAccountService) {}

  @Get('account')
  @ApiOperation({ summary: 'Coordonnées chez ce traiteur, accord du traiteur, demandes possibles' })
  @ApiOkResponse({ schema: zodToOpenApi(clientAccountSchema, 'output') })
  getAccount(@CurrentUser() user: AuthenticatedUser): Promise<ClientAccount> {
    return this.account.get(user);
  }
}

import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type ApiClientCodeRequestInput,
  apiClientCodeRequestSchema,
  type ApiClientVerifyInput,
  apiClientVerifySchema,
  type AuthSession,
  authSessionSchema,
  type ClientCodeResponse,
  clientCodeResponseSchema,
} from '@traiteur/shared';

import { Client, type ClientInfo } from '../common/http/client-info';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ClientAuthService } from './client-auth.service';
import { Public } from './decorators';

/**
 * Site client d'un traiteur : connexion et inscription sans mot de passe (code par SMS, ou par
 * e-mail pour un numéro étranger). Le traiteur est posé par le serveur web d'après l'adresse.
 */
@ApiTags('auth')
@Public()
@Controller('auth/client')
@UseGuards(ThrottlerGuard)
export class ClientAuthController {
  constructor(private readonly clients: ClientAuthService) {}

  @Post('code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Code de connexion : SMS, ou e-mail pour un numéro étranger (EMAIL_REQUIRED sans adresse) ; réponse identique que le compte existe ou non',
  })
  @ApiBody({ schema: zodToOpenApi(apiClientCodeRequestSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(clientCodeResponseSchema, 'output') })
  code(
    @Body(new ZodValidationPipe(apiClientCodeRequestSchema)) body: ApiClientCodeRequestInput,
    @Client() client: ClientInfo,
  ): Promise<ClientCodeResponse> {
    return this.clients.requestCode(body, client);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Session client ; SIGNUP_REQUIRED (inscription avec consentement) ou CONSENT_REQUIRED, le code restant valable',
  })
  @ApiBody({ schema: zodToOpenApi(apiClientVerifySchema) })
  @ApiOkResponse({ schema: zodToOpenApi(authSessionSchema, 'output') })
  verify(
    @Body(new ZodValidationPipe(apiClientVerifySchema)) body: ApiClientVerifyInput,
    @Client() client: ClientInfo,
  ): Promise<AuthSession> {
    return this.clients.verify(body, client);
  }
}

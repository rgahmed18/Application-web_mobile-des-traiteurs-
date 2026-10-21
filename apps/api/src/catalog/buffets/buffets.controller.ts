import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type Buffet,
  type BuffetInput,
  buffetInputSchema,
  type BuffetListQuery,
  buffetListQuerySchema,
  type BuffetPage,
  buffetPageSchema,
  buffetSchema,
} from '@traiteur/shared';

import type { AuthenticatedUser } from '../../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../auth/decorators';
import { Client, type ClientInfo } from '../../common/http/client-info';
import { uuidParam } from '../../common/http/uuid-param';
import { zodToOpenApi } from '../../common/zod/zod-openapi';
import { ZodValidationPipe } from '../../common/zod/zod-validation.pipe';
import { BuffetsService } from './buffets.service';

const buffetResponse = { schema: zodToOpenApi(buffetSchema, 'output') };

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog/buffets')
export class BuffetsController {
  constructor(private readonly buffets: BuffetsService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Buffets : recherche, filtres (type, gamme), pagination' })
  @ApiOkResponse({ schema: zodToOpenApi(buffetPageSchema, 'output') })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(buffetListQuerySchema)) query: BuffetListQuery,
  ): Promise<BuffetPage> {
    return this.buffets.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOkResponse(buffetResponse)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string): Promise<Buffet> {
    return this.buffets.get(user, id);
  }

  @Post()
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(buffetInputSchema) })
  @ApiOkResponse(buffetResponse)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(buffetInputSchema)) body: BuffetInput,
    @Client() client: ClientInfo,
  ): Promise<Buffet> {
    return this.buffets.create(user, body, client);
  }

  @Put(':id')
  @RequirePermissions('catalog.write')
  @ApiBody({ schema: zodToOpenApi(buffetInputSchema) })
  @ApiOkResponse(buffetResponse)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(buffetInputSchema)) body: BuffetInput,
    @Client() client: ClientInfo,
  ): Promise<Buffet> {
    return this.buffets.update(user, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOkResponse(buffetResponse)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Buffet> {
    return this.buffets.archive(user, id, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('catalog.write')
  @ApiOkResponse(buffetResponse)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<Buffet> {
    return this.buffets.restore(user, id, client);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Supprime un buffet' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.buffets.remove(user, id, client);
  }
}

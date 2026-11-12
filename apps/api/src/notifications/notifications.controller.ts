import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type NotificationFeed, notificationFeedSchema } from '@traiteur/shared';

import type { AuthenticatedUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { uuidParam } from '../common/http/uuid-param';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { NotificationsService } from './notifications.service';

/** Cloche du back-office : notifications visibles selon les droits du membre. */
@ApiTags('notifications')
@ApiBearerAuth()
@Roles('ADMIN_TRAITEUR', 'EMPLOYE', 'EQUIPE', 'LIVREUR')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Dernières notifications et nombre de non lues' })
  @ApiOkResponse({ schema: zodToOpenApi(notificationFeedSchema, 'output') })
  feed(@CurrentUser() user: AuthenticatedUser): Promise<NotificationFeed> {
    return this.notifications.feed(user);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: zodToOpenApi(notificationFeedSchema, 'output') })
  readAll(@CurrentUser() user: AuthenticatedUser): Promise<NotificationFeed> {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: zodToOpenApi(notificationFeedSchema, 'output') })
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<NotificationFeed> {
    return this.notifications.markRead(user, id);
  }
}

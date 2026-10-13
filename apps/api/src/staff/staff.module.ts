import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { InvitationsService } from './invitations.service';
import { PublicInvitationsController } from './public-invitations.controller';
import { RolePermissionsService } from './role-permissions.service';
import { RolePermissionsController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/** Personnel : équipe, invitations et activation, suspension, grille des permissions. */
@Module({
  imports: [AuthModule],
  controllers: [StaffController, RolePermissionsController, PublicInvitationsController],
  providers: [StaffService, InvitationsService, RolePermissionsService],
})
export class StaffModule {}

import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type AuthSession,
  authSessionSchema,
  type LoginInput,
  type LoginResult,
  loginResultSchema,
  loginSchema,
  type Me,
  meSchema,
  type OtpRequestInput,
  type OtpRequestResponse,
  otpRequestResponseSchema,
  otpRequestSchema,
  type OtpVerifyInput,
  otpVerifySchema,
  type PasswordResetInput,
  passwordResetSchema,
  type RefreshTokenInput,
  refreshTokenSchema,
  type RecoveryCodes,
  recoveryCodesSchema,
  type RegisterInput,
  registerSchema,
  type TwoFactorChallengeConfirmInput,
  type TwoFactorChallengeConfirmResult,
  twoFactorChallengeConfirmResultSchema,
  twoFactorChallengeConfirmSchema,
  type TwoFactorChallengeSetupInput,
  twoFactorChallengeSetupSchema,
  type TwoFactorConfirmInput,
  twoFactorConfirmSchema,
  type TwoFactorProofInput,
  twoFactorProofSchema,
  type TwoFactorSetupInfo,
  twoFactorSetupInfoSchema,
  type TwoFactorStatus,
  twoFactorStatusSchema,
  type TwoFactorVerifyInput,
  twoFactorVerifySchema,
} from '@traiteur/shared';

import { Client, type ClientInfo } from '../common/http/client-info';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import type { AuthenticatedUser } from './auth-user';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './decorators';

const sessionResponse = { schema: zodToOpenApi(authSessionSchema, 'output') };
/** Session, ou deuxième étape si la double authentification est active ou imposée. */
const loginResponse = {
  description: 'Session, ou { twoFactor: VERIFY | SETUP, challengeToken, expiresIn }',
  schema: zodToOpenApi(loginResultSchema, 'output'),
};

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Inscription client (mot de passe + code SMS SIGNUP)' })
  @ApiBody({ schema: zodToOpenApi(registerSchema) })
  @ApiOkResponse(sessionResponse)
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Client() client: ClientInfo,
  ): Promise<AuthSession> {
    return this.auth.register(body, client);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Connexion par téléphone ou email + mot de passe' })
  @ApiBody({ schema: zodToOpenApi(loginSchema) })
  @ApiOkResponse(loginResponse)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Client() client: ClientInfo,
  ): Promise<LoginResult> {
    return this.auth.login(body, client);
  }

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Envoi d’un code SMS (LOGIN, SIGNUP ou PASSWORD_RESET)' })
  @ApiBody({ schema: zodToOpenApi(otpRequestSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(otpRequestResponseSchema, 'output') })
  requestOtp(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequestInput,
    @Client() client: ClientInfo,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(body, client);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Connexion (ou inscription sans mot de passe) par code SMS' })
  @ApiBody({ schema: zodToOpenApi(otpVerifySchema) })
  @ApiOkResponse(loginResponse)
  verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyInput,
    @Client() client: ClientInfo,
  ): Promise<LoginResult> {
    return this.auth.verifyOtp(body, client);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Deuxième étape : code de l’application ou code de secours (5 essais par jeton, verrouillage progressif du compte)',
  })
  @ApiBody({ schema: zodToOpenApi(twoFactorVerifySchema) })
  @ApiOkResponse(sessionResponse)
  verifyTwoFactor(
    @Body(new ZodValidationPipe(twoFactorVerifySchema)) body: TwoFactorVerifyInput,
    @Client() client: ClientInfo,
  ): Promise<AuthSession> {
    return this.auth.verifyTwoFactor(body, client);
  }

  @Public()
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Activation imposée à la connexion : clé et QR code à scanner' })
  @ApiBody({ schema: zodToOpenApi(twoFactorChallengeSetupSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(twoFactorSetupInfoSchema, 'output') })
  setupTwoFactor(
    @Body(new ZodValidationPipe(twoFactorChallengeSetupSchema)) body: TwoFactorChallengeSetupInput,
  ): Promise<TwoFactorSetupInfo> {
    return this.auth.setupTwoFactorChallenge(body);
  }

  @Public()
  @Post('2fa/setup/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Premier code de l’application : session et codes de secours (affichés une seule fois)',
  })
  @ApiBody({ schema: zodToOpenApi(twoFactorChallengeConfirmSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(twoFactorChallengeConfirmResultSchema, 'output') })
  confirmTwoFactor(
    @Body(new ZodValidationPipe(twoFactorChallengeConfirmSchema))
    body: TwoFactorChallengeConfirmInput,
    @Client() client: ClientInfo,
  ): Promise<TwoFactorChallengeConfirmResult> {
    return this.auth.confirmTwoFactorChallenge(body, client);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Nouveau mot de passe après code SMS PASSWORD_RESET' })
  @ApiBody({ schema: zodToOpenApi(passwordResetSchema) })
  @ApiNoContentResponse()
  resetPassword(
    @Body(new ZodValidationPipe(passwordResetSchema)) body: PasswordResetInput,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.auth.resetPassword(body, client);
  }

  @Public()
  @Post('refresh')
  // À chaque chargement de page et avant l'expiration du jeton : plusieurs membres d'une même
  // équipe partagent souvent une adresse IP (box du traiteur). Le jeton rotatif protège déjà.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotation du refresh token' })
  @ApiBody({ schema: zodToOpenApi(refreshTokenSchema) })
  @ApiOkResponse(sessionResponse)
  refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput,
    @Client() client: ClientInfo,
  ): Promise<AuthSession> {
    return this.auth.refresh(body.refreshToken, client);
  }

  @Public()
  @Post('logout')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Déconnexion (révoque la session)' })
  @ApiBody({ schema: zodToOpenApi(refreshTokenSchema) })
  @ApiNoContentResponse()
  logout(@Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput): Promise<void> {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  // Route authentifiée, appelée à chaque ouverture de session : limite large (IP partagée)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Utilisateur courant, contexte et permissions effectives' })
  @ApiOkResponse({ schema: zodToOpenApi(meSchema, 'output') })
  me(@CurrentUser() user: AuthenticatedUser): Promise<Me> {
    return this.auth.me(user);
  }
}

/** Double authentification du compte connecté (« Mon compte »). */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('me/two-factor')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class TwoFactorAccountController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'État : active, imposée, codes de secours restants' })
  @ApiOkResponse({ schema: zodToOpenApi(twoFactorStatusSchema, 'output') })
  status(@CurrentUser() user: AuthenticatedUser): Promise<TwoFactorStatus> {
    return this.auth.twoFactorStatus(user);
  }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activation : clé et QR code à scanner' })
  @ApiOkResponse({ schema: zodToOpenApi(twoFactorSetupInfoSchema, 'output') })
  setup(@CurrentUser() user: AuthenticatedUser): Promise<TwoFactorSetupInfo> {
    return this.auth.beginTwoFactorSetup(user);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Premier code : activée ; codes de secours affichés une seule fois' })
  @ApiBody({ schema: zodToOpenApi(twoFactorConfirmSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(recoveryCodesSchema, 'output') })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(twoFactorConfirmSchema)) body: TwoFactorConfirmInput,
    @Client() client: ClientInfo,
  ): Promise<RecoveryCodes> {
    return this.auth.confirmTwoFactorSetup(user, body.code, client);
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Désactivation (impossible si imposée) : code exigé' })
  @ApiBody({ schema: zodToOpenApi(twoFactorProofSchema) })
  @ApiNoContentResponse()
  disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(twoFactorProofSchema)) body: TwoFactorProofInput,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.auth.disableTwoFactor(user, body.code, client);
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nouveaux codes de secours (les anciens sont annulés) : code exigé' })
  @ApiBody({ schema: zodToOpenApi(twoFactorProofSchema) })
  @ApiOkResponse({ schema: zodToOpenApi(recoveryCodesSchema, 'output') })
  regenerate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(twoFactorProofSchema)) body: TwoFactorProofInput,
    @Client() client: ClientInfo,
  ): Promise<RecoveryCodes> {
    return this.auth.regenerateRecoveryCodes(user, body.code, client);
  }
}

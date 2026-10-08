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
  type RegisterInput,
  registerSchema,
} from '@traiteur/shared';

import { Client, type ClientInfo } from '../common/http/client-info';
import { zodToOpenApi } from '../common/zod/zod-openapi';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import type { AuthenticatedUser } from './auth-user';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './decorators';

const sessionResponse = { schema: zodToOpenApi(authSessionSchema, 'output') };

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
  @ApiOkResponse(sessionResponse)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Client() client: ClientInfo,
  ): Promise<AuthSession> {
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
  @ApiOkResponse(sessionResponse)
  verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyInput,
    @Client() client: ClientInfo,
  ): Promise<AuthSession> {
    return this.auth.verifyOtp(body, client);
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
  ): Promise<void> {
    return this.auth.resetPassword(body);
  }

  @Public()
  @Post('refresh')
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Déconnexion (révoque la session)' })
  @ApiBody({ schema: zodToOpenApi(refreshTokenSchema) })
  @ApiNoContentResponse()
  logout(@Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput): Promise<void> {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Utilisateur courant, contexte et permissions effectives' })
  @ApiOkResponse({ schema: zodToOpenApi(meSchema, 'output') })
  me(@CurrentUser() user: AuthenticatedUser): Promise<Me> {
    return this.auth.me(user);
  }
}

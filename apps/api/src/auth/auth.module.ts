import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { CatalogModule } from '../catalog/catalog.module';
import type { AppConfigService } from '../config/app-config.module';
import { ActivationsService } from './activation/activations.service';
import { PublicActivationsController } from './activation/public-activations.controller';
import { AuthController, TwoFactorAccountController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClientAuthController } from './client-auth.controller';
import { ClientAuthService } from './client-auth.service';
import { createEmailProvider, EMAIL_PROVIDER } from './otp/email.provider';
import { OtpService } from './otp/otp.service';
import { createSmsProvider } from './otp/sms/sms-factory';
import { SMS_PROVIDER } from './otp/sms.provider';
import { PasswordService } from './password.service';
import { PlatformAccessController } from './platform-access.controller';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor/two-factor.service';

@Module({
  imports: [
    CatalogModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [
    AuthController,
    ClientAuthController,
    TwoFactorAccountController,
    PublicActivationsController,
    PlatformAccessController,
  ],
  providers: [
    AuthService,
    ClientAuthService,
    PasswordService,
    TokenService,
    TwoFactorService,
    ActivationsService,
    OtpService,
    // console (développement), agrégateur http ou Twilio, avec fournisseur de secours
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: AppConfigService) =>
        createSmsProvider({
          SMS_PROVIDER: config.get('SMS_PROVIDER', { infer: true }),
          OUTBOX_DIR: config.get('OUTBOX_DIR', { infer: true }),
          SMS_FALLBACK_PROVIDER: config.get('SMS_FALLBACK_PROVIDER', { infer: true }),
          SMS_TIMEOUT_MS: config.get('SMS_TIMEOUT_MS', { infer: true }),
          SMS_SENDER: config.get('SMS_SENDER', { infer: true }),
          SMS_HTTP_URL: config.get('SMS_HTTP_URL', { infer: true }),
          SMS_HTTP_METHOD: config.get('SMS_HTTP_METHOD', { infer: true }),
          SMS_HTTP_BODY: config.get('SMS_HTTP_BODY', { infer: true }),
          SMS_HTTP_CONTENT_TYPE: config.get('SMS_HTTP_CONTENT_TYPE', { infer: true }),
          SMS_HTTP_AUTH_HEADER: config.get('SMS_HTTP_AUTH_HEADER', { infer: true }),
          SMS_HTTP_PHONE_FORMAT: config.get('SMS_HTTP_PHONE_FORMAT', { infer: true }),
          SMS_HTTP_SUCCESS_PATTERN: config.get('SMS_HTTP_SUCCESS_PATTERN', { infer: true }),
          TWILIO_ACCOUNT_SID: config.get('TWILIO_ACCOUNT_SID', { infer: true }),
          TWILIO_AUTH_TOKEN: config.get('TWILIO_AUTH_TOKEN', { infer: true }),
          TWILIO_FROM: config.get('TWILIO_FROM', { infer: true }),
          TWILIO_MESSAGING_SERVICE_SID: config.get('TWILIO_MESSAGING_SERVICE_SID', { infer: true }),
        }),
    },
    // Codes des numéros étrangers : console (simulé), API http, ou désactivé (production par défaut)
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: AppConfigService) =>
        createEmailProvider({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          EMAIL_PROVIDER: config.get('EMAIL_PROVIDER', { infer: true }),
          OUTBOX_DIR: config.get('OUTBOX_DIR', { infer: true }),
          EMAIL_FROM: config.get('EMAIL_FROM', { infer: true }),
          EMAIL_HTTP_URL: config.get('EMAIL_HTTP_URL', { infer: true }),
          EMAIL_HTTP_BODY: config.get('EMAIL_HTTP_BODY', { infer: true }),
          EMAIL_HTTP_AUTH_HEADER_NAME: config.get('EMAIL_HTTP_AUTH_HEADER_NAME', { infer: true }),
          EMAIL_HTTP_AUTH_HEADER_VALUE: config.get('EMAIL_HTTP_AUTH_HEADER_VALUE', {
            infer: true,
          }),
          EMAIL_TIMEOUT_MS: config.get('EMAIL_TIMEOUT_MS', { infer: true }),
        }),
    },
  ],
  exports: [TokenService, PasswordService, SMS_PROVIDER, EMAIL_PROVIDER],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import type { AppConfigService } from '../config/app-config.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';
import { ConsoleSmsProvider, SMS_PROVIDER } from './otp/sms.provider';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [
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
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    OtpService,
    // Seul fournisseur disponible pour l'instant ; un fournisseur réel sera choisi via SMS_PROVIDER.
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
  ],
  exports: [TokenService],
})
export class AuthModule {}

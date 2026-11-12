import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhone, OTP_CODE_LENGTH, type OtpRequestResponse } from '@traiteur/shared';

import { appErrors } from '../../common/errors';
import type { Env } from '../../config/env.schema';
import type { OtpPurpose } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_PROVIDER, type EmailMessage, type EmailProvider, maskEmail } from './email.provider';
import { SMS_PROVIDER, type SmsProvider } from './sms.provider';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface OtpRequestOptions {
  /** false = ne pas envoyer de SMS mais répondre à l'identique (anti-énumération des comptes). */
  deliver?: boolean;
  ipAddress?: string | null;
}

export interface EmailOtpRequestOptions extends OtpRequestOptions {
  /** Objet et texte de l'e-mail pour un code (langue, nom du traiteur). */
  message: (code: string, minutes: number) => Omit<EmailMessage, 'to'>;
}

@Injectable()
export class OtpService {
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly cooldownSeconds: number;
  private readonly maxPerHour: number;
  private readonly maxPerIpPerDay: number;
  private readonly smsDailyLimit: number;
  private readonly emailDailyLimit: number;
  private readonly allowedCountryCodes: readonly string[];
  private readonly secret: string;
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    config: ConfigService<Env, true>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {
    this.ttlSeconds = config.get('OTP_TTL_SECONDS', { infer: true });
    this.maxAttempts = config.get('OTP_MAX_ATTEMPTS', { infer: true });
    this.cooldownSeconds = config.get('OTP_RESEND_COOLDOWN_SECONDS', { infer: true });
    this.maxPerHour = config.get('OTP_MAX_PER_HOUR', { infer: true });
    this.maxPerIpPerDay = config.get('OTP_MAX_PER_IP_PER_DAY', { infer: true });
    this.smsDailyLimit = config.get('SMS_DAILY_GLOBAL_LIMIT', { infer: true });
    this.emailDailyLimit = config.get('EMAIL_DAILY_GLOBAL_LIMIT', { infer: true });
    this.allowedCountryCodes = config.get('SMS_ALLOWED_COUNTRY_CODES', { infer: true });
    this.secret = config.get('OTP_SECRET', { infer: true });
  }

  /**
   * Génère un code, invalide les précédents et l'envoie par SMS.
   *
   * Protections contre le « SMS pumping » (envoi massif de SMS surtaxés aux frais du traiteur) :
   * délai entre deux envois, quota par numéro (1 h), quota par IP (24 h), indicatifs pays
   * autorisés et plafond global de SMS (24 h). Chaque plafond atteint est journalisé (warn).
   */
  async requestCode(
    phone: string,
    purpose: OtpPurpose,
    { deliver = true, ipAddress = null }: OtpRequestOptions = {},
  ): Promise<OtpRequestResponse> {
    const now = new Date();
    await this.assertQuotas(phone, purpose, ipAddress, now);

    // Indicatifs non autorisés : le code est créé (réponse identique) mais aucun SMS ne part.
    const countryAllowed = this.isSmsAllowed(phone);
    if (deliver && !countryAllowed) {
      this.logger.log(`SMS non envoyé : indicatif non autorisé (${maskPhone(phone)})`);
    }
    const sendSms = deliver && countryAllowed;

    // Plafond global de SMS envoyés sur 24 h (coût maîtrisé même en cas d'attaque distribuée)
    if (sendSms) {
      const sentToday = await this.prisma.otpCode.count({
        where: { smsSentAt: { gt: new Date(now.getTime() - DAY_MS) } },
      });
      if (sentToday >= this.smsDailyLimit) {
        this.logger.warn(`Plafond global de SMS atteint (${this.smsDailyLimit} sur 24 h)`);
        throw appErrors.tooManyRequests(
          'OTP_RATE_LIMITED',
          "L'envoi de SMS est temporairement indisponible, réessayez plus tard",
          { retryAfterSeconds: 3600 },
        );
      }
    }

    const code = this.generateCode();
    const [, created] = await this.prisma.$transaction([
      // Un seul code actif à la fois par usage
      this.prisma.otpCode.updateMany({
        where: { phone, purpose, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
      this.prisma.otpCode.create({
        data: {
          phone,
          purpose,
          codeHash: this.hashCode(phone, purpose, code),
          expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
          maxAttempts: this.maxAttempts,
          ipAddress,
          // Réservé avant l'envoi pour être compté dans le plafond global
          smsSentAt: sendSms ? now : null,
        },
      }),
    ]);

    if (sendSms) {
      const minutes = Math.round(this.ttlSeconds / 60);
      try {
        await this.sms.send(
          phone,
          `Votre code de vérification : ${code} (valable ${minutes} min).`,
        );
      } catch (error) {
        await this.prisma.otpCode.update({ where: { id: created.id }, data: { smsSentAt: null } });
        this.logger.error(`Code non envoyé à ${maskPhone(phone)} : ${String(error)}`);
        throw new ServiceUnavailableException({
          code: 'SMS_UNAVAILABLE',
          message: "L'envoi de SMS est momentanément indisponible, réessayez dans quelques minutes",
        });
      }
    }

    return { retryAfterSeconds: this.cooldownSeconds, expiresInSeconds: this.ttlSeconds };
  }

  /**
   * Code envoyé par e-mail, pour un numéro qui ne reçoit pas de SMS (étranger). Le code est lié
   * au numéro ET à l'adresse. Mêmes protections que les SMS : délai, quotas par numéro, par
   * adresse et par IP, plafond global d'e-mails. `deliver: false` : code créé, rien d'envoyé,
   * réponse identique (adresse qui ne correspond pas au compte du numéro).
   */
  async requestEmailCode(
    phone: string,
    email: string,
    purpose: OtpPurpose,
    { deliver = true, ipAddress = null, message }: EmailOtpRequestOptions,
  ): Promise<OtpRequestResponse> {
    if (!this.email.enabled) {
      throw new ServiceUnavailableException({
        code: 'EMAIL_UNAVAILABLE',
        message: "L'envoi de codes par e-mail n'est pas disponible",
      });
    }
    const now = new Date();
    await this.assertQuotas(phone, purpose, ipAddress, now, email);
    if (deliver) {
      const sentToday = await this.prisma.otpCode.count({
        where: { emailSentAt: { gt: new Date(now.getTime() - DAY_MS) } },
      });
      if (sentToday >= this.emailDailyLimit) {
        this.logger.warn(`Plafond global d'e-mails atteint (${this.emailDailyLimit} sur 24 h)`);
        throw appErrors.tooManyRequests(
          'OTP_RATE_LIMITED',
          "L'envoi d'e-mails est temporairement indisponible, réessayez plus tard",
          { retryAfterSeconds: 3600 },
        );
      }
    }

    const code = this.generateCode();
    const [, created] = await this.prisma.$transaction([
      this.prisma.otpCode.updateMany({
        where: { phone, purpose, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
      this.prisma.otpCode.create({
        data: {
          phone,
          purpose,
          channel: 'EMAIL',
          email,
          codeHash: this.hashCode(phone, purpose, code, email),
          expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
          maxAttempts: this.maxAttempts,
          ipAddress,
          emailSentAt: deliver ? now : null,
        },
      }),
    ]);

    if (deliver) {
      try {
        await this.email.send({ to: email, ...message(code, Math.round(this.ttlSeconds / 60)) });
      } catch (error) {
        await this.prisma.otpCode.update({
          where: { id: created.id },
          data: { emailSentAt: null },
        });
        this.logger.error(`Code non envoyé à ${maskEmail(email)} : ${String(error)}`);
        throw new ServiceUnavailableException({
          code: 'EMAIL_UNAVAILABLE',
          message: "L'envoi de l'e-mail a échoué, réessayez dans quelques minutes",
        });
      }
    }
    return { retryAfterSeconds: this.cooldownSeconds, expiresInSeconds: this.ttlSeconds };
  }

  /** Le numéro (E.164) appartient-il à un indicatif autorisé à recevoir des SMS ? */
  isSmsAllowed(phone: string): boolean {
    return this.allowedCountryCodes.some((code) => phone.startsWith(`+${code}`));
  }

  /** Vérifie et consomme un code en une seule étape. */
  async verifyCode(phone: string, purpose: OtpPurpose, code: string): Promise<void> {
    await this.consumeCode(await this.checkCode(phone, purpose, code));
  }

  /**
   * Vérifie un code SANS le consommer et retourne son identifiant. `email` : code envoyé par
   * e-mail à cette adresse (numéro étranger) ; sinon, code envoyé par SMS.
   * Chaque essai est décompté de façon atomique : au-delà de maxAttempts, le code est
   * verrouillé et un nouveau doit être demandé. Utile quand la suite peut échouer pour une
   * raison corrigeable (ex. profil manquant) : le code reste alors utilisable.
   */
  async checkCode(
    phone: string,
    purpose: OtpPurpose,
    code: string,
    email: string | null = null,
  ): Promise<string> {
    const now = new Date();
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, email, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw appErrors.badRequest('INVALID_OTP', 'Code invalide ou expiré');

    const counted = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, usedAt: null, attempts: { lt: otp.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
      throw appErrors.tooManyRequests('OTP_LOCKED', 'Trop de tentatives, demandez un nouveau code');
    }

    if (!this.matches(otp.codeHash, this.hashCode(phone, purpose, code, email))) {
      const remainingAttempts = Math.max(0, otp.maxAttempts - otp.attempts - 1);
      throw appErrors.badRequest('INVALID_OTP', 'Code invalide ou expiré', { remainingAttempts });
    }
    return otp.id;
  }

  /** Consommation atomique : deux requêtes simultanées ne peuvent pas utiliser le même code. */
  async consumeCode(otpId: string): Promise<void> {
    const now = new Date();
    const consumed = await this.prisma.otpCode.updateMany({
      where: { id: otpId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count === 0) throw appErrors.badRequest('INVALID_OTP', 'Code invalide ou expiré');
  }

  generateCode(): string {
    return randomInt(0, 10 ** OTP_CODE_LENGTH)
      .toString()
      .padStart(OTP_CODE_LENGTH, '0');
  }

  /**
   * HMAC lié au numéro et à l'usage (et à l'adresse pour un code envoyé par e-mail) : un code ne
   * peut pas servir à autre chose.
   */
  hashCode(phone: string, purpose: OtpPurpose, code: string, email: string | null = null): string {
    const target = email === null ? phone : `${phone}|${email}`;
    return createHmac('sha256', this.secret).update(`${target}:${purpose}:${code}`).digest('hex');
  }

  /** Délai entre deux envois, quotas par numéro, par IP et (code par e-mail) par adresse. */
  private async assertQuotas(
    phone: string,
    purpose: OtpPurpose,
    ipAddress: string | null,
    now: Date,
    email?: string,
  ): Promise<void> {
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const recent = await this.prisma.otpCode.findMany({
      where: { phone, createdAt: { gt: hourAgo } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, purpose: true },
    });

    // Délai minimal entre deux envois pour un même usage
    const last = recent.find((otp) => otp.purpose === purpose);
    if (last) {
      const elapsed = (now.getTime() - last.createdAt.getTime()) / 1000;
      if (elapsed < this.cooldownSeconds) {
        throw appErrors.tooManyRequests(
          'OTP_RATE_LIMITED',
          'Veuillez patienter avant de redemander un code',
          { retryAfterSeconds: Math.ceil(this.cooldownSeconds - elapsed) },
        );
      }
    }

    // Quota horaire par numéro, tous usages confondus
    if (recent.length >= this.maxPerHour) {
      this.logger.warn(`Quota horaire de codes atteint pour ${maskPhone(phone)}`);
      throw this.rateLimited(3600);
    }

    // Quota horaire par adresse e-mail, tous numéros confondus
    if (email) {
      const toEmail = await this.prisma.otpCode.count({
        where: { email, createdAt: { gt: hourAgo } },
      });
      if (toEmail >= this.maxPerHour) {
        this.logger.warn(`Quota horaire de codes atteint pour ${maskEmail(email)}`);
        throw this.rateLimited(3600);
      }
    }

    // Quota par IP sur 24 h, tous numéros confondus (un attaquant fait varier les numéros)
    if (ipAddress) {
      const fromIp = await this.prisma.otpCode.count({
        where: { ipAddress, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
      });
      if (fromIp >= this.maxPerIpPerDay) {
        this.logger.warn(`Quota quotidien de codes atteint pour l'IP ${ipAddress}`);
        throw this.rateLimited(24 * 3600);
      }
    }
  }

  private rateLimited(retryAfterSeconds: number) {
    return appErrors.tooManyRequests(
      'OTP_RATE_LIMITED',
      'Trop de codes demandés, réessayez plus tard',
      { retryAfterSeconds },
    );
  }

  private matches(expectedHash: string, actualHash: string): boolean {
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(actualHash, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhone, OTP_CODE_LENGTH, type OtpRequestResponse } from '@traiteur/shared';

import { appErrors } from '../../common/errors';
import type { Env } from '../../config/env.schema';
import type { OtpPurpose } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from './sms.provider';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface OtpRequestOptions {
  /** false = ne pas envoyer de SMS mais répondre à l'identique (anti-énumération des comptes). */
  deliver?: boolean;
  ipAddress?: string | null;
}

@Injectable()
export class OtpService {
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly cooldownSeconds: number;
  private readonly maxPerHour: number;
  private readonly maxPerIpPerDay: number;
  private readonly smsDailyLimit: number;
  private readonly allowedCountryCodes: readonly string[];
  private readonly secret: string;
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('OTP_TTL_SECONDS', { infer: true });
    this.maxAttempts = config.get('OTP_MAX_ATTEMPTS', { infer: true });
    this.cooldownSeconds = config.get('OTP_RESEND_COOLDOWN_SECONDS', { infer: true });
    this.maxPerHour = config.get('OTP_MAX_PER_HOUR', { infer: true });
    this.maxPerIpPerDay = config.get('OTP_MAX_PER_IP_PER_DAY', { infer: true });
    this.smsDailyLimit = config.get('SMS_DAILY_GLOBAL_LIMIT', { infer: true });
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
    const recent = await this.prisma.otpCode.findMany({
      where: { phone, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
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
      throw appErrors.tooManyRequests(
        'OTP_RATE_LIMITED',
        'Trop de codes demandés, réessayez plus tard',
        { retryAfterSeconds: 3600 },
      );
    }

    // Quota par IP sur 24 h, tous numéros confondus (un attaquant fait varier les numéros)
    const dayAgo = new Date(now.getTime() - DAY_MS);
    if (ipAddress) {
      const fromIp = await this.prisma.otpCode.count({
        where: { ipAddress, createdAt: { gt: dayAgo } },
      });
      if (fromIp >= this.maxPerIpPerDay) {
        this.logger.warn(`Quota quotidien de codes atteint pour l'IP ${ipAddress}`);
        throw appErrors.tooManyRequests(
          'OTP_RATE_LIMITED',
          'Trop de codes demandés, réessayez plus tard',
          { retryAfterSeconds: 24 * 3600 },
        );
      }
    }

    // Indicatifs non autorisés : le code est créé (réponse identique) mais aucun SMS ne part.
    const countryAllowed = this.isSmsAllowed(phone);
    if (deliver && !countryAllowed) {
      this.logger.log(`SMS non envoyé : indicatif non autorisé (${maskPhone(phone)})`);
    }
    const sendSms = deliver && countryAllowed;

    // Plafond global de SMS envoyés sur 24 h (coût maîtrisé même en cas d'attaque distribuée)
    if (sendSms) {
      const sentToday = await this.prisma.otpCode.count({
        where: { smsSentAt: { gt: dayAgo } },
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
        throw error;
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
   * Vérifie un code SANS le consommer et retourne son identifiant.
   * Chaque essai est décompté de façon atomique : au-delà de maxAttempts, le code est
   * verrouillé et un nouveau doit être demandé. Utile quand la suite peut échouer pour une
   * raison corrigeable (ex. profil manquant) : le code reste alors utilisable.
   */
  async checkCode(phone: string, purpose: OtpPurpose, code: string): Promise<string> {
    const now = new Date();
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, usedAt: null, expiresAt: { gt: now } },
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

    if (!this.matches(otp.codeHash, this.hashCode(phone, purpose, code))) {
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

  /** HMAC lié au numéro et à l'usage : un code ne peut pas servir à autre chose. */
  hashCode(phone: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.secret).update(`${phone}:${purpose}:${code}`).digest('hex');
  }

  private matches(expectedHash: string, actualHash: string): boolean {
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(actualHash, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

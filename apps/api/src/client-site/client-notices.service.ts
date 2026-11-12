import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhone } from '@traiteur/shared';

import { EMAIL_PROVIDER, type EmailProvider } from '../auth/otp/email.provider';
import { SMS_PROVIDER, type SmsProvider } from '../auth/otp/sms.provider';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { SpacesService } from '../spaces/spaces.service';

/** Message à un client, dans sa langue (texte court : il part aussi par SMS). */
export type ClientNotice = (context: { traiteur: string; url: string }) => {
  fr: string;
  ar: string;
};

/**
 * Avis envoyés aux clients du site (compte accepté ou refusé…) : par SMS si son numéro en reçoit,
 * sinon par e-mail à l'adresse de sa fiche. Au mieux : un échec d'envoi est journalisé sans
 * empêcher la décision du traiteur, qui reste visible dans l'espace du client.
 */
@Injectable()
export class ClientNoticesService {
  private readonly logger = new Logger(ClientNoticesService.name);
  private readonly smsCountries: readonly string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    config: ConfigService<Env, true>,
  ) {
    this.smsCountries = config.get('SMS_ALLOWED_COUNTRY_CODES', { infer: true });
  }

  /** Envoie l'avis ; retourne le canal utilisé, ou null si aucun envoi n'a été possible. */
  async send(membershipId: string, notice: ClientNotice): Promise<'SMS' | 'EMAIL' | null> {
    const member = await this.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: {
        locale: true,
        email: true,
        traiteurId: true,
        user: { select: { phone: true } },
        traiteur: { select: { name: true } },
      },
    });
    const url = `${await this.spaces.tenantUrl(member.traiteurId)}/espace`;
    const texts = notice({ traiteur: member.traiteur.name, url });
    const text = member.locale === 'ar' ? texts.ar : texts.fr;
    const phone = member.user.phone;
    try {
      if (this.smsCountries.some((code) => phone.startsWith(`+${code}`))) {
        await this.sms.send(phone, text);
        return 'SMS';
      }
      if (member.email && this.email.enabled) {
        await this.email.send({ to: member.email, subject: member.traiteur.name, text });
        return 'EMAIL';
      }
    } catch (error) {
      this.logger.warn(`Avis non envoyé au client (${maskPhone(phone)}) : ${String(error)}`);
    }
    return null;
  }
}

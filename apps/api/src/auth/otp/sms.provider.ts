import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@traiteur/shared';

/** Fournisseur d'envoi de SMS (implémentation réelle à brancher : opérateur marocain, Twilio...). */
export interface SmsProvider {
  send(phone: string, message: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * Fournisseur simulé pour le développement : le SMS est écrit dans les logs de l'API.
 * Interdit en production (validation des variables d'environnement).
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS simulé');

  send(phone: string, message: string): Promise<void> {
    this.logger.log(`→ ${maskPhone(phone)} : ${message}`);
    return Promise.resolve();
  }
}

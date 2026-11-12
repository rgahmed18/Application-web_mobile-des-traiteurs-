import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@traiteur/shared';

/** Fournisseur d'envoi de SMS : console, agrégateur HTTP ou Twilio (voir sms/sms-factory.ts). */
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

/**
 * Parcours e2e : le dernier SMS de chaque numéro est écrit dans un fichier (sms-<numéro>.txt),
 * relu par les tests pour saisir le code. Interdit en production (variables d'environnement).
 */
export class OutboxSmsProvider implements SmsProvider {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  send(phone: string, message: string): Promise<void> {
    writeFileSync(path.join(this.directory, `sms-${phone.replace(/\D/g, '')}.txt`), message);
    return Promise.resolve();
  }
}

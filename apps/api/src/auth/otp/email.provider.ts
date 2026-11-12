import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Logger } from '@nestjs/common';

import type { Env } from '../../config/env.schema';
import type { FetchLike } from './sms/sms-providers';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Envoi d'un e-mail (codes de vérification des numéros étrangers). */
export interface EmailProvider {
  /** false : aucun envoi possible (fournisseur désactivé). */
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** Adresse masquée pour les journaux : « a***@exemple.fr ». */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Envoi refusé ou en échec ; le message ne contient ni le texte (un code) ni l'adresse complète. */
export class EmailDeliveryError extends Error {
  constructor(detail: string) {
    super(`E-mail non envoyé : ${detail}`);
    this.name = 'EmailDeliveryError';
  }
}

/** Développement et démonstration : l'e-mail est écrit dans les journaux de l'API. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly enabled = true;
  private readonly logger = new Logger('E-mail simulé');

  send({ to, subject, text }: EmailMessage): Promise<void> {
    this.logger.log(`→ ${maskEmail(to)} : ${subject} — ${text}`);
    return Promise.resolve();
  }
}

/** Parcours e2e : le dernier e-mail de chaque adresse est écrit dans email-<adresse>.txt. */
export class OutboxEmailProvider implements EmailProvider {
  readonly enabled = true;

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  send({ to, subject, text }: EmailMessage): Promise<void> {
    const name = `email-${to.replace(/[^a-z0-9@.-]/gi, '_')}.txt`;
    writeFileSync(path.join(this.directory, name), `${subject}\n${text}`);
    return Promise.resolve();
  }
}

/** Aucun fournisseur : les numéros sans SMS ne peuvent pas recevoir de code. */
export class DisabledEmailProvider implements EmailProvider {
  readonly enabled = false;

  send(): Promise<void> {
    return Promise.reject(new EmailDeliveryError('aucun fournisseur configuré'));
  }
}

export interface HttpEmailSettings {
  url: string;
  /** Corps JSON avec {{to}}, {{from}}, {{subject}}, {{text}} (valeurs échappées pour JSON). */
  body: string;
  from: string;
  authHeaderName: string;
  authHeaderValue: string;
  timeoutMs: number;
}

/** Remplit le gabarit JSON du corps, chaque valeur échappée comme une chaîne JSON. */
export function fillEmailTemplate(
  template: string,
  values: Record<'to' | 'from' | 'subject' | 'text', string>,
): string {
  return template.replace(/\{\{\s*(to|from|subject|text)\s*\}\}/g, (_, name: keyof typeof values) =>
    JSON.stringify(values[name]).slice(1, -1),
  );
}

/** API d'envoi d'e-mails générique (Brevo, Mailjet, Postmark…) : POST JSON, succès = 2xx. */
export class HttpEmailProvider implements EmailProvider {
  readonly enabled = true;

  constructor(
    private readonly settings: HttpEmailSettings,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send({ to, subject, text }: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.settings.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          [this.settings.authHeaderName]: this.settings.authHeaderValue,
        },
        body: fillEmailTemplate(this.settings.body, {
          to,
          from: this.settings.from,
          subject,
          text,
        }),
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch (error) {
      throw new EmailDeliveryError(error instanceof Error ? error.name : 'erreur réseau');
    }
    if (!response.ok) throw new EmailDeliveryError(`statut ${response.status}`);
  }
}

type EmailEnv = Pick<
  Env,
  | 'NODE_ENV'
  | 'EMAIL_PROVIDER'
  | 'EMAIL_FROM'
  | 'EMAIL_HTTP_URL'
  | 'EMAIL_HTTP_BODY'
  | 'EMAIL_HTTP_AUTH_HEADER_NAME'
  | 'EMAIL_HTTP_AUTH_HEADER_VALUE'
  | 'EMAIL_TIMEOUT_MS'
  | 'OUTBOX_DIR'
>;

/** Fournisseur selon la configuration ; sans choix : console, ou désactivé en production. */
export function createEmailProvider(env: EmailEnv, fetchImpl: FetchLike = fetch): EmailProvider {
  const kind = env.EMAIL_PROVIDER ?? (env.NODE_ENV === 'production' ? 'disabled' : 'console');
  if (kind === 'console') return new ConsoleEmailProvider();
  if (kind === 'outbox') return new OutboxEmailProvider(env.OUTBOX_DIR ?? '.outbox');
  if (kind === 'disabled') return new DisabledEmailProvider();
  return new HttpEmailProvider(
    {
      url: env.EMAIL_HTTP_URL ?? '',
      body: env.EMAIL_HTTP_BODY ?? '',
      from: env.EMAIL_FROM ?? '',
      authHeaderName: env.EMAIL_HTTP_AUTH_HEADER_NAME,
      authHeaderValue: env.EMAIL_HTTP_AUTH_HEADER_VALUE ?? '',
      timeoutMs: env.EMAIL_TIMEOUT_MS,
    },
    fetchImpl,
  );
}

import { Logger } from '@nestjs/common';
import { maskPhone } from '@traiteur/shared';

import type { SmsProvider } from '../sms.provider';

/** fetch injectable (tests). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Envoi refusé ou en échec. Le message ne contient jamais le texte du SMS (un code de
 * connexion), le numéro complet, l'URL (qui peut porter une clé) ni la réponse du fournisseur.
 */
export class SmsDeliveryError extends Error {
  constructor(
    readonly provider: string,
    detail: string,
  ) {
    super(`SMS non envoyé (${provider}) : ${detail}`);
    this.name = 'SmsDeliveryError';
  }
}

export type PhoneFormat = 'e164' | 'international' | 'national';

/** +212612345678 → selon le format attendu par le fournisseur. */
export function formatPhone(phone: string, format: PhoneFormat): string {
  const digits = phone.replace(/^\+/, '');
  if (format === 'e164') return `+${digits}`;
  if (format === 'international') return digits;
  return digits.startsWith('212') ? `0${digits.slice(3)}` : `+${digits}`;
}

type Encoding = 'url' | 'json' | 'raw';

/** Remplace {{to}}, {{message}}, {{sender}} en encodant chaque valeur selon l'endroit. */
export function fillTemplate(
  template: string,
  values: Record<'to' | 'message' | 'sender', string>,
  encoding: Encoding,
): string {
  return template.replace(/\{\{\s*(to|message|sender)\s*\}\}/g, (_, name: keyof typeof values) => {
    const value = values[name];
    if (encoding === 'url') return encodeURIComponent(value);
    if (encoding === 'json') return JSON.stringify(value).slice(1, -1);
    return value;
  });
}

export interface HttpSmsSettings {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  contentType: 'json' | 'form';
  authHeader?: string;
  phoneFormat: PhoneFormat;
  successPattern?: string;
  sender: string;
  timeoutMs: number;
}

/**
 * Agrégateur SMS par API HTTP (fournisseurs marocains : envoi par GET ou POST, clé dans l'URL
 * ou dans un en-tête). Succès : statut 2xx et, si configuré, motif présent dans la réponse.
 */
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';

  constructor(
    private readonly settings: HttpSmsSettings,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const values = {
      to: formatPhone(phone, this.settings.phoneFormat),
      message,
      sender: this.settings.sender,
    };
    const headers: Record<string, string> = {};
    if (this.settings.authHeader) headers.Authorization = this.settings.authHeader;
    let body: string | undefined;
    if (this.settings.method === 'POST' && this.settings.body) {
      const json = this.settings.contentType === 'json';
      headers['Content-Type'] = json ? 'application/json' : 'application/x-www-form-urlencoded';
      body = fillTemplate(this.settings.body, values, json ? 'json' : 'url');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(fillTemplate(this.settings.url, values, 'url'), {
        method: this.settings.method,
        headers,
        body,
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch (error) {
      throw new SmsDeliveryError(this.name, errorKind(error));
    }
    if (!response.ok) throw new SmsDeliveryError(this.name, `statut HTTP ${response.status}`);
    if (this.settings.successPattern) {
      const text = await response.text();
      if (!new RegExp(this.settings.successPattern).test(text)) {
        throw new SmsDeliveryError(this.name, 'réponse sans confirmation de succès');
      }
    }
  }
}

export interface TwilioSettings {
  accountSid: string;
  authToken: string;
  from?: string;
  messagingServiceSid?: string;
  timeoutMs: number;
}

/** Twilio (API Messages) : fournisseur de secours, fiable et bien documenté. */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(
    private readonly settings: TwilioSettings,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const form = new URLSearchParams({ To: formatPhone(phone, 'e164'), Body: message });
    if (this.settings.messagingServiceSid) {
      form.set('MessagingServiceSid', this.settings.messagingServiceSid);
    } else if (this.settings.from) {
      form.set('From', this.settings.from);
    }
    const credentials = Buffer.from(
      `${this.settings.accountSid}:${this.settings.authToken}`,
    ).toString('base64');
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${this.settings.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(this.settings.timeoutMs),
        },
      );
    } catch (error) {
      throw new SmsDeliveryError(this.name, errorKind(error));
    }
    if (!response.ok) {
      // Code d'erreur Twilio (ex. 21211 : numéro invalide), sans le reste de la réponse
      const code = await response
        .json()
        .then((data: unknown) => (data as { code?: unknown }).code)
        .catch(() => undefined);
      throw new SmsDeliveryError(
        this.name,
        `statut HTTP ${response.status}${typeof code === 'number' ? `, code ${code}` : ''}`,
      );
    }
  }
}

/**
 * Fournisseur principal, puis de secours s'il échoue (indisponibilité, refus, délai dépassé).
 * Seul un échec de tous les fournisseurs remonte à l'appelant.
 */
export class FailoverSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  constructor(private readonly providers: readonly (SmsProvider & { name: string })[]) {}

  async send(phone: string, message: string): Promise<void> {
    const failures: string[] = [];
    for (const provider of this.providers) {
      try {
        await provider.send(phone, message);
        if (failures.length > 0) {
          this.logger.warn(`SMS envoyé par ${provider.name} après échec : ${failures.join(' ; ')}`);
        }
        return;
      } catch (error) {
        const detail = error instanceof SmsDeliveryError ? error.message : errorKind(error);
        failures.push(detail);
        this.logger.warn(`${detail} → ${maskPhone(phone)}`);
      }
    }
    throw new SmsDeliveryError('tous', failures.join(' ; '));
  }
}

function errorKind(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'délai dépassé';
  }
  return 'fournisseur injoignable';
}

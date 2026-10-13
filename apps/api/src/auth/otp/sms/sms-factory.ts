import type { Env } from '../../../config/env.schema';
import { ConsoleSmsProvider, type SmsProvider } from '../sms.provider';
import {
  type FetchLike,
  FailoverSmsProvider,
  HttpSmsProvider,
  TwilioSmsProvider,
} from './sms-providers';

type SmsEnv = Pick<
  Env,
  | 'SMS_PROVIDER'
  | 'SMS_FALLBACK_PROVIDER'
  | 'SMS_TIMEOUT_MS'
  | 'SMS_SENDER'
  | 'SMS_HTTP_URL'
  | 'SMS_HTTP_METHOD'
  | 'SMS_HTTP_BODY'
  | 'SMS_HTTP_CONTENT_TYPE'
  | 'SMS_HTTP_AUTH_HEADER'
  | 'SMS_HTTP_PHONE_FORMAT'
  | 'SMS_HTTP_SUCCESS_PATTERN'
  | 'TWILIO_ACCOUNT_SID'
  | 'TWILIO_AUTH_TOKEN'
  | 'TWILIO_FROM'
  | 'TWILIO_MESSAGING_SERVICE_SID'
>;

/**
 * Fournisseur SMS selon la configuration (validée au démarrage : les paramètres du fournisseur
 * choisi sont présents). Hors « console », l'envoi passe par le principal puis le secours.
 */
export function createSmsProvider(env: SmsEnv, fetchImpl: FetchLike = fetch): SmsProvider {
  if (env.SMS_PROVIDER === 'console') return new ConsoleSmsProvider();
  const build = (kind: 'http' | 'twilio') =>
    kind === 'http'
      ? new HttpSmsProvider(
          {
            url: env.SMS_HTTP_URL ?? '',
            method: env.SMS_HTTP_METHOD,
            body: env.SMS_HTTP_BODY,
            contentType: env.SMS_HTTP_CONTENT_TYPE,
            authHeader: env.SMS_HTTP_AUTH_HEADER,
            phoneFormat: env.SMS_HTTP_PHONE_FORMAT,
            successPattern: env.SMS_HTTP_SUCCESS_PATTERN,
            sender: env.SMS_SENDER ?? '',
            timeoutMs: env.SMS_TIMEOUT_MS,
          },
          fetchImpl,
        )
      : new TwilioSmsProvider(
          {
            accountSid: env.TWILIO_ACCOUNT_SID ?? '',
            authToken: env.TWILIO_AUTH_TOKEN ?? '',
            from: env.TWILIO_FROM ?? env.SMS_SENDER,
            messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
            timeoutMs: env.SMS_TIMEOUT_MS,
          },
          fetchImpl,
        );
  const chain = [build(env.SMS_PROVIDER)];
  if (env.SMS_FALLBACK_PROVIDER !== 'none') chain.push(build(env.SMS_FALLBACK_PROVIDER));
  return new FailoverSmsProvider(chain);
}

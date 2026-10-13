import { validateEnv } from '../../../config/env.schema';
import { createSmsProvider } from './sms-factory';
import {
  type FetchLike,
  fillTemplate,
  formatPhone,
  HttpSmsProvider,
  SmsDeliveryError,
} from './sms-providers';

interface Call {
  url: string;
  init: RequestInit;
}

/** Faux réseau : enregistre les requêtes et répond selon `respond`. */
function fakeFetch(respond: (url: string) => Response | Error = () => new Response('OK')) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const result = respond(url);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { calls, fetchImpl };
}

/** Corps texte d'une requête enregistrée (les fournisseurs envoient toujours du texte). */
const bodyOf = (call: Call | undefined): string =>
  typeof call?.init.body === 'string' ? call.init.body : '';

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_SECRET: 'b'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'cle',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_PUBLIC_URL: 'http://localhost:9000/traiteur-media',
};
const TWILIO = {
  TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'jeton-twilio-secret-0123456789',
  TWILIO_FROM: 'DarDiafa',
};
const SECRET_KEY = 'cle-api-secrete-123';
const CODE = 'Votre code de vérification : 481516 (valable 5 min).';
const PHONE = '+212612345678';

describe('fournisseurs SMS', () => {
  it('formate le numéro selon le fournisseur', () => {
    expect(formatPhone(PHONE, 'e164')).toBe('+212612345678');
    expect(formatPhone(PHONE, 'international')).toBe('212612345678');
    expect(formatPhone(PHONE, 'national')).toBe('0612345678');
  });

  it('remplit les gabarits en encodant selon l’endroit (URL, JSON)', () => {
    const values = { to: '212612345678', message: 'Code : 1 & "2"', sender: 'Dar Diafa' };
    expect(fillTemplate('https://x.ma/s?to={{to}}&t={{ message }}', values, 'url')).toBe(
      'https://x.ma/s?to=212612345678&t=Code%20%3A%201%20%26%20%222%22',
    );
    expect(JSON.parse(fillTemplate('{"text":"{{message}}"}', values, 'json'))).toEqual({
      text: 'Code : 1 & "2"',
    });
  });

  it('agrégateur HTTP en GET : clé et paramètres dans l’URL, texte arabe encodé', async () => {
    const { calls, fetchImpl } = fakeFetch();
    const provider = new HttpSmsProvider(
      {
        url: `https://api.exemple.ma/send?key=${SECRET_KEY}&to={{to}}&text={{message}}&from={{sender}}`,
        method: 'GET',
        contentType: 'json',
        phoneFormat: 'international',
        sender: 'DarDiafa',
        timeoutMs: 1_000,
      },
      fetchImpl,
    );
    await provider.send(PHONE, 'رمز التحقق : 481516');
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('to')).toBe('212612345678');
    expect(url.searchParams.get('text')).toBe('رمز التحقق : 481516');
    expect(url.searchParams.get('from')).toBe('DarDiafa');
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('agrégateur HTTP en POST JSON, avec en-tête d’authentification et motif de succès', async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response('{"status":"refused"}'));
    const provider = new HttpSmsProvider(
      {
        url: 'https://api.exemple.ma/v1/sms',
        method: 'POST',
        body: '{"to":"{{to}}","message":"{{message}}"}',
        contentType: 'json',
        authHeader: `Bearer ${SECRET_KEY}`,
        phoneFormat: 'e164',
        successPattern: '"status":"sent"',
        sender: '',
        timeoutMs: 1_000,
      },
      fetchImpl,
    );
    const error = await provider.send(PHONE, CODE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SmsDeliveryError);
    expect(JSON.parse(bodyOf(calls[0]))).toEqual({ to: PHONE, message: CODE });
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it('Twilio : API Messages, authentification Basic, numéro E.164', async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response('{}', { status: 201 }));
    const provider = createSmsProvider(
      validateEnv({ ...baseEnv, ...TWILIO, SMS_PROVIDER: 'twilio' }),
      fetchImpl,
    );
    await provider.send(PHONE, CODE);
    expect(calls[0]?.url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO.TWILIO_ACCOUNT_SID}/Messages.json`,
    );
    const form = new URLSearchParams(bodyOf(calls[0]));
    expect(form.get('To')).toBe(PHONE);
    expect(form.get('From')).toBe('DarDiafa');
    expect(form.get('Body')).toBe(CODE);
  });

  it('bascule sur Twilio si l’agrégateur échoue ; erreurs sans secret ni code', async () => {
    const { calls, fetchImpl } = fakeFetch((url) =>
      url.startsWith('https://api.exemple.ma')
        ? new Response('panne', { status: 503 })
        : new Response('{}', { status: 201 }),
    );
    const env = validateEnv({
      ...baseEnv,
      ...TWILIO,
      SMS_PROVIDER: 'http',
      SMS_FALLBACK_PROVIDER: 'twilio',
      SMS_HTTP_URL: `https://api.exemple.ma/send?key=${SECRET_KEY}&to={{to}}&text={{message}}`,
      SMS_HTTP_METHOD: 'GET',
    });
    await createSmsProvider(env, fetchImpl).send(PHONE, CODE);
    expect(calls.map((call) => new URL(call.url).host)).toEqual([
      'api.exemple.ma',
      'api.twilio.com',
    ]);

    // Tous en panne : une seule erreur, qui ne révèle ni la clé, ni le code, ni le numéro
    const down = fakeFetch(() => new TypeError('fetch failed'));
    const error = await createSmsProvider(env, down.fetchImpl)
      .send(PHONE, CODE)
      .catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(SmsDeliveryError);
    const text = (error as Error).message;
    for (const secret of [SECRET_KEY, '481516', '612345678', TWILIO.TWILIO_AUTH_TOKEN]) {
      expect(text).not.toContain(secret);
    }
  });

  it('configuration : paramètres du fournisseur choisi exigés, secours différent', () => {
    expect(() => validateEnv({ ...baseEnv, SMS_PROVIDER: 'http' })).toThrow(/SMS_HTTP_URL/);
    expect(() => validateEnv({ ...baseEnv, SMS_PROVIDER: 'twilio' })).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(() =>
      validateEnv({
        ...baseEnv,
        ...TWILIO,
        SMS_PROVIDER: 'twilio',
        SMS_FALLBACK_PROVIDER: 'twilio',
      }),
    ).toThrow(/SMS_FALLBACK_PROVIDER/);
    expect(() =>
      validateEnv({ ...baseEnv, NODE_ENV: 'production', SMS_PROVIDER: 'console' }),
    ).toThrow(/SMS_PROVIDER/);
  });
});

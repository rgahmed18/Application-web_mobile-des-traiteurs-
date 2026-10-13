import { Body, Controller, type INestApplication, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/node';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { Public } from '../../src/auth/decorators';
import { sentryOptions } from '../../src/observability/sentry';

/**
 * Rapports d'erreur Sentry : la chaîne complète du SDK est exercée (seul le transport réseau
 * est remplacé). Une requête chargée de données personnelles et de secrets provoque une erreur
 * 500 : rien de personnel ni de secret ne doit figurer dans ce qui partirait vers Sentry.
 */
const PHONE = '+212612345678';
const EMAIL = 'salma.bennani@exemple.ma';
const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const SECRETS = [
  PHONE,
  '612345678',
  EMAIL,
  JWT,
  'Password123!',
  'cookie-de-session-secret',
  'Salma',
  'Bennani',
  '12, rue des Orangers',
  '41.250.1.2',
];

@Public()
@Controller('test-sentry')
class FailingController {
  @Post()
  fail(@Body() body: Record<string, unknown>): never {
    // Données que l'application ou le SDK pourraient associer à l'erreur
    Sentry.getIsolationScope().setUser({ id: 'u1', email: EMAIL, ip_address: '41.250.1.2' });
    Sentry.getIsolationScope().setExtra('client', body);
    Sentry.addBreadcrumb({ category: 'sms', message: `Envoi à ${PHONE}`, data: { body } });
    throw new Error(`Échec de l'envoi pour ${EMAIL} (${PHONE})`);
  }
}

describe('Sentry : aucune donnée personnelle ni secret envoyé', () => {
  let app: INestApplication;
  const envelopes: string[] = [];

  beforeAll(async () => {
    // Sous Jest, l'instrumentation automatique (OpenTelemetry, interception des modules) n'est
    // pas prise en charge et fait planter le processus des tests suivants : elle est coupée ici.
    // Le reste de la chaîne (nos options, scopes, beforeSend, filtrage, transport) est réel.
    Sentry.init({
      ...sentryOptions('api', {
        dsn: 'https://clepublique@o0.ingest.sentry.io/1',
        environment: 'staging',
        transport: (options) =>
          Sentry.createTransport(options, (envelope) => {
            const body = envelope.body;
            envelopes.push(typeof body === 'string' ? body : Buffer.from(body).toString('utf8'));
            return Promise.resolve({ statusCode: 200 });
          }),
      }),
      defaultIntegrations: false,
      enableOpenTelemetrySetup: false,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [FailingController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await Sentry.close(2_000);
  });

  it('collecte du SDK entièrement désactivée', () => {
    expect(Sentry.getClient()?.getOptions().dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it('erreur 500 avec données personnelles : envoyée, mais filtrée', async () => {
    const server = app.getHttpServer() as App;
    await request(server)
      .post('/api/v1/test-sentry?token=jeton-dans-url-secret')
      .set('Authorization', `Bearer ${JWT}`)
      .set('Cookie', 'traiteur_refresh=cookie-de-session-secret')
      .set('X-Forwarded-For', '41.250.1.2')
      .send({
        phone: PHONE,
        email: EMAIL,
        password: 'Password123!',
        firstName: 'Salma',
        lastName: 'Bennani',
        address: '12, rue des Orangers',
      })
      .expect(500);
    await Sentry.flush(2_000);

    const sent = envelopes.join('\n');
    expect(sent).toContain('Error');
    expect(sent).toContain('[e-mail]');
    // Les traces restent exploitables : fichiers et fonctions, sans extrait de code source
    expect(sent).toContain('FailingController.fail');
    expect(sent).not.toContain('pre_context');
    for (const secret of [...SECRETS, 'jeton-dans-url-secret']) {
      expect(sent).not.toContain(secret);
    }
  });

  it('une erreur métier (4xx) n’est pas envoyée', async () => {
    // Événements d'erreur seulement (pas les statistiques internes du SDK)
    const errors = () => envelopes.join(' ').split('"type":"event"').length - 1;
    const before = errors();
    await request(app.getHttpServer() as App)
      .get('/api/v1/orders')
      .expect(401);
    await Sentry.flush(2_000);
    expect(errors()).toBe(before);
  });
});

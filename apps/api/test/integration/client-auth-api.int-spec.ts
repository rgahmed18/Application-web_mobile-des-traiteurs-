import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { syncPermissionCatalog } from '../../src/access/permission-catalog';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { EMAIL_PROVIDER, type EmailMessage } from '../../src/auth/otp/email.provider';
import { SMS_PROVIDER } from '../../src/auth/otp/sms.provider';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma } from './helpers';

/**
 * Connexion et inscription des clients sur le site d'un traiteur : code par SMS ou par e-mail
 * (numéro étranger), inscription avec consentement, compte connu chez un autre traiteur sans
 * rien en révéler, validation des nouveaux clients, personnel renvoyé vers l'espace de gestion.
 */
const randomPhone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const randomForeignPhone = () => `+336${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

interface ErrorBody {
  code: string;
  message: string;
  firstName?: string;
}

describe('Clients du site : connexion et inscription (application complète)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const sms: { phone: string; message: string }[] = [];
  const emails: EmailMessage[] = [];
  let open: { slug: string; id: string; privacy: string };
  let moderated: { slug: string; id: string; privacy: string };

  const server = (): App => app.getHttpServer() as App;
  // Adresse différente à chaque appel : la limitation de débit n'est pas l'objet de ces tests
  const post = (path: string, body: object) =>
    request(server())
      .post(`/api/v1${path}`)
      .set(
        'X-Forwarded-For',
        `41.251.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      )
      .send(body);

  const smsCode = (phone: string) =>
    /(\d{6})/.exec(sms.filter((item) => item.phone === phone).at(-1)?.message ?? '')?.[1] ?? '';
  const emailCode = (to: string) =>
    /(\d{6})/.exec(emails.filter((item) => item.to === to).at(-1)?.subject ?? '')?.[1] ?? '';

  async function createTraiteur(requireClientApproval: boolean) {
    const suffix = randomUUID().slice(0, 8);
    const traiteur = await prisma.traiteur.create({
      data: {
        slug: `site-${suffix}`,
        name: `Traiteur ${suffix}`,
        email: 'contact@exemple.ma',
        phone: '+212500000000',
        status: 'ACTIVE',
        requireClientApproval,
      },
    });
    const privacy = await request(server())
      .get(`/api/v1/public/traiteurs/${traiteur.slug}/privacy`)
      .expect(200);
    return {
      slug: traiteur.slug,
      id: traiteur.id,
      privacy: (privacy.body as { version: string }).version,
    };
  }

  const signup = (privacyVersion: string, extra: Record<string, unknown> = {}) => ({
    firstName: 'Salma',
    lastName: 'Bennani',
    consent: true,
    privacyVersion,
    ...extra,
  });

  beforeAll(async () => {
    prisma = createTestPrisma();
    await syncPermissionCatalog(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({
        send: (phone: string, message: string) => {
          sms.push({ phone, message });
          return Promise.resolve();
        },
      })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({
        enabled: true,
        send: (message: EmailMessage) => {
          emails.push(message);
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    open = await createTraiteur(false);
    moderated = await createTraiteur(true);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('numéro marocain : code SMS, inscription avec consentement, puis simple connexion', async () => {
    const phone = randomPhone();
    const sent = await post('/auth/client/code', { traiteurSlug: open.slug, phone }).expect(200);
    expect(sent.body).toMatchObject({
      channel: 'SMS',
      expiresInSeconds: expect.any(Number) as number,
    });
    const code = smsCode(phone);

    // Compte inconnu : inscription demandée, le code reste valable
    const required = await post('/auth/client/verify', { traiteurSlug: open.slug, phone, code });
    expect(required.status).toBe(400);
    expect((required.body as ErrorBody).code).toBe('SIGNUP_REQUIRED');
    // Politique affichée périmée : refus, le code reste valable
    const stale = await post('/auth/client/verify', {
      traiteurSlug: open.slug,
      phone,
      code,
      signup: signup('2026-11.0000000000000000'),
    });
    expect((stale.body as ErrorBody).code).toBe('PRIVACY_POLICY_CHANGED');

    const session = await post('/auth/client/verify', {
      traiteurSlug: open.slug,
      phone,
      code,
      signup: signup(open.privacy, { email: 'Salma@Exemple.ma' }),
    }).expect(200);
    expect((session.body as { context: { role: string } }).context.role).toBe('CLIENT');
    const membership = await prisma.membership.findFirstOrThrow({
      where: { traiteurId: open.id, user: { phone } },
      include: { user: true },
    });
    expect(membership).toMatchObject({
      role: 'CLIENT',
      firstName: 'Salma',
      email: 'salma@exemple.ma',
      clientApproval: 'APPROVED',
      privacyPolicyVersion: open.privacy,
    });
    expect(membership.privacyConsentAt).toBeInstanceOf(Date);
    expect(membership.privacyConsentIp).toMatch(/^41\.251\./);
    expect(membership.user.passwordHash).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { traiteurId: open.id, action: 'client.self_registered', entityId: membership.id },
    });
    expect(audit?.after).toMatchObject({ clientApproval: 'APPROVED' });

    // Code déjà utilisé : refusé
    expect(
      (await post('/auth/client/verify', { traiteurSlug: open.slug, phone, code })).status,
    ).toBe(400);
    // Nouvelle visite (délai entre deux codes écoulé) : connexion directe, sans inscription
    await prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(0) } });
    await post('/auth/client/code', { traiteurSlug: open.slug, phone }).expect(200);
    const again = await post('/auth/client/verify', {
      traiteurSlug: open.slug,
      phone,
      code: smsCode(phone),
    }).expect(200);
    expect((again.body as { context: { membershipId: string } }).context.membershipId).toBe(
      membership.id,
    );
    expect(await prisma.membership.count({ where: { user: { phone } } })).toBe(1);
  });

  it('client d’un autre traiteur : même réponse qu’un inconnu, fiche à son nom ici, en attente', async () => {
    // Client existant chez « open »
    const known = randomPhone();
    const user = await prisma.user.create({
      data: {
        phone: known,
        firstName: 'Nom',
        lastName: 'Ailleurs',
        email: `${randomUUID()}@exemple.ma`,
      },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        traiteurId: open.id,
        role: 'CLIENT',
        firstName: 'Nom',
        lastName: 'Ailleurs',
        internalNotes: 'Client difficile',
        privacyConsentAt: new Date(),
        privacyPolicyVersion: open.privacy,
      },
    });
    const unknown = randomPhone();
    for (const phone of [known, unknown]) {
      await post('/auth/client/code', { traiteurSlug: moderated.slug, phone }).expect(200);
    }
    const verifyWithoutSignup = (phone: string) =>
      post('/auth/client/verify', { traiteurSlug: moderated.slug, phone, code: smsCode(phone) });
    const forKnown = await verifyWithoutSignup(known);
    const forUnknown = await verifyWithoutSignup(unknown);
    expect(forKnown.status).toBe(forUnknown.status);
    expect(forKnown.body).toEqual(forUnknown.body);

    const session = await post('/auth/client/verify', {
      traiteurSlug: moderated.slug,
      phone: known,
      code: smsCode(known),
      signup: signup(moderated.privacy, { firstName: 'Yasmine', lastName: 'Idrissi' }),
    }).expect(200);
    expect(JSON.stringify(session.body)).not.toContain('Client difficile');
    const here = await prisma.membership.findFirstOrThrow({
      where: { traiteurId: moderated.id, userId: user.id },
    });
    expect(here).toMatchObject({
      firstName: 'Yasmine',
      lastName: 'Idrissi',
      internalNotes: null,
      clientApproval: 'PENDING',
    });
    // Rien ne change chez l'autre traiteur ni sur le compte
    const elsewhere = await prisma.membership.findFirstOrThrow({
      where: { traiteurId: open.id, userId: user.id },
    });
    expect(elsewhere.firstName).toBe('Nom');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).firstName).toBe('Nom');
  });

  it('numéro étranger : code par e-mail, adresse obligatoire, envoyé seulement à la bonne adresse', async () => {
    const phone = randomForeignPhone();
    const email = `mre-${randomUUID().slice(0, 6)}@exemple.fr`;
    const missing = await post('/auth/client/code', { traiteurSlug: open.slug, phone });
    expect(missing.status).toBe(400);
    expect((missing.body as ErrorBody).code).toBe('EMAIL_REQUIRED');

    const sent = await post('/auth/client/code', {
      traiteurSlug: open.slug,
      phone,
      email,
      locale: 'ar',
    }).expect(200);
    expect((sent.body as { channel: string }).channel).toBe('EMAIL');
    expect(sms.some((item) => item.phone === phone)).toBe(false);
    expect(emails.at(-1)?.text).toContain('رمز التحقق');
    const code = emailCode(email);
    // Code présenté sans l'adresse : refusé
    expect(
      (await post('/auth/client/verify', { traiteurSlug: open.slug, phone, code })).status,
    ).toBe(400);
    await post('/auth/client/verify', {
      traiteurSlug: open.slug,
      phone,
      email,
      code,
      signup: signup(open.privacy, { firstName: 'Karim' }),
    }).expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(user.email).toBe(email);

    // Plus tard : une autre adresse ne reçoit rien (réponse identique) ; la bonne, si
    await prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(0) } });
    const before = emails.length;
    const wrong = await post('/auth/client/code', {
      traiteurSlug: open.slug,
      phone,
      email: 'pirate@exemple.fr',
    }).expect(200);
    expect(emails).toHaveLength(before);
    await prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(0) } });
    const right = await post('/auth/client/code', { traiteurSlug: open.slug, phone, email }).expect(
      200,
    );
    expect(wrong.body).toEqual(right.body);
    expect(emails).toHaveLength(before + 1);
    await post('/auth/client/verify', {
      traiteurSlug: open.slug,
      phone,
      email,
      code: emailCode(email),
    }).expect(200);
  });

  it('fiche créée au back-office : consentement demandé une fois, puis enregistré', async () => {
    const phone = randomPhone();
    const user = await prisma.user.create({
      data: { phone, firstName: 'Hind', lastName: 'Saadi' },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        traiteurId: open.id,
        role: 'CLIENT',
        firstName: 'Hind',
        lastName: 'Saadi',
      },
    });
    await post('/auth/client/code', { traiteurSlug: open.slug, phone }).expect(200);
    const code = smsCode(phone);
    const required = await post('/auth/client/verify', { traiteurSlug: open.slug, phone, code });
    expect(required.body).toMatchObject({ code: 'CONSENT_REQUIRED', firstName: 'Hind' });
    await post('/auth/client/verify', {
      traiteurSlug: open.slug,
      phone,
      code,
      consent: { consent: true, privacyVersion: open.privacy },
    }).expect(200);
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    expect(membership.privacyPolicyVersion).toBe(open.privacy);
  });

  it('personnel et super admin : renvoyés vers l’espace de gestion, aucune fiche client', async () => {
    const phone = randomPhone();
    const user = await prisma.user.create({
      data: { phone, firstName: 'Admin', lastName: 'Equipe' },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        traiteurId: open.id,
        role: 'ADMIN_TRAITEUR',
        firstName: 'Admin',
        lastName: 'Equipe',
      },
    });
    await post('/auth/client/code', { traiteurSlug: open.slug, phone }).expect(200);
    const refused = await post('/auth/client/verify', {
      traiteurSlug: open.slug,
      phone,
      code: smsCode(phone),
      signup: signup(open.privacy),
    });
    expect(refused.status).toBe(403);
    expect((refused.body as ErrorBody).code).toBe('USE_BACKOFFICE');
    expect(await prisma.membership.count({ where: { userId: user.id, role: 'CLIENT' } })).toBe(0);
  });

  it('anciennes routes : jamais de compte ni de fiche client créés sans consentement', async () => {
    const phone = randomPhone();
    await post('/auth/otp/request', { phone, purpose: 'LOGIN' }).expect(200);
    const response = await post('/auth/otp/verify', {
      traiteurSlug: open.slug,
      phone,
      code: smsCode(phone),
    });
    expect((response.body as ErrorBody).code).toBe('SIGNUP_REQUIRED');
    expect(await prisma.user.count({ where: { phone } })).toBe(0);
    await post('/auth/register', {}).expect(404);
  });

  it('traiteur suspendu : ni code ni inscription', async () => {
    await prisma.traiteur.update({ where: { id: moderated.id }, data: { status: 'SUSPENDED' } });
    const response = await post('/auth/client/code', {
      traiteurSlug: moderated.slug,
      phone: randomPhone(),
    });
    expect((response.body as ErrorBody).code).toBe('TRAITEUR_UNAVAILABLE');
    await prisma.traiteur.update({ where: { id: moderated.id }, data: { status: 'ACTIVE' } });
  });
});

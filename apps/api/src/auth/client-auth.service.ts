import { Injectable } from '@nestjs/common';
import type {
  ApiClientCodeRequestInput,
  ApiClientVerifyInput,
  AuthSession,
  ClientCodeResponse,
  Locale,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import { PublicCatalogService } from '../catalog/public/public-catalog.service';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import type { Membership, User } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { EmailMessage } from './otp/email.provider';
import { OtpService } from './otp/otp.service';

/** E-mail du code (numéros étrangers), dans la langue du visiteur. */
function codeEmail(
  locale: Locale | undefined,
  traiteur: string,
  code: string,
  minutes: number,
): Omit<EmailMessage, 'to'> {
  if (locale === 'ar') {
    return {
      subject: `رمز التحقق: ${code} – ${traiteur}`,
      text: `رمز التحقق الخاص بك لدى ${traiteur} هو ${code} (صالح لمدة ${minutes} دقيقة). إذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.`,
    };
  }
  return {
    subject: `Votre code de vérification : ${code} – ${traiteur}`,
    text: `Votre code de vérification chez ${traiteur} est ${code} (valable ${minutes} min). Si vous n'avez rien demandé, ignorez ce message.`,
  };
}

const sameEmail = (a: string | null | undefined, b: string) => a?.toLowerCase() === b;

/**
 * Connexion et inscription des clients sur le site d'un traiteur, sans mot de passe.
 *
 * - Code par SMS (indicatifs autorisés), ou par e-mail pour un numéro étranger : l'e-mail n'est
 *   envoyé que si l'adresse est celle du compte du numéro (ou si le numéro est inconnu) ;
 *   réponse identique dans tous les cas.
 * - Après un code valide : un client de CE traiteur est connecté ; un compte inconnu ou connu
 *   seulement chez un autre traiteur reçoit la même réponse (SIGNUP_REQUIRED), puis s'inscrit
 *   avec le même code : nom, e-mail facultatif, consentement horodaté à la politique de
 *   confidentialité de ce traiteur. Rien d'un autre traiteur n'est lu ni recopié.
 * - Un membre du personnel est renvoyé vers l'espace de gestion.
 */
@Injectable()
export class ClientAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly site: PublicCatalogService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async requestCode(
    input: ApiClientCodeRequestInput,
    client: ClientInfo,
  ): Promise<ClientCodeResponse> {
    const traiteur = await this.traiteur(input.traiteurSlug);
    if (this.otp.isSmsAllowed(input.phone)) {
      const response = await this.otp.requestCode(input.phone, 'LOGIN', {
        ipAddress: client.ipAddress,
      });
      return { ...response, channel: 'SMS' };
    }
    const email = this.requireEmail(input.email);
    // Adresse du compte de ce numéro (ou de sa fiche chez ce traiteur) ; numéro inconnu : envoi
    // à l'adresse donnée, qui deviendra celle du compte.
    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone },
      select: {
        email: true,
        memberships: { where: { traiteurId: traiteur.id }, select: { email: true } },
      },
    });
    const deliver =
      !user ||
      sameEmail(user.email, email) ||
      user.memberships.some((membership) => sameEmail(membership.email, email));
    const response = await this.otp.requestEmailCode(input.phone, email, 'LOGIN', {
      deliver,
      ipAddress: client.ipAddress,
      message: (code, minutes) => codeEmail(input.locale, traiteur.name, code, minutes),
    });
    return { ...response, channel: 'EMAIL' };
  }

  async verify(input: ApiClientVerifyInput, client: ClientInfo): Promise<AuthSession> {
    const traiteur = await this.traiteur(input.traiteurSlug);
    const codeEmailAddress = this.otp.isSmsAllowed(input.phone)
      ? null
      : this.requireEmail(input.email);
    // Le code n'est consommé qu'au succès : une inscription ou un consentement demandé le garde
    const otpId = await this.otp.checkCode(input.phone, 'LOGIN', input.code, codeEmailAddress);

    const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    if (user && user.status !== 'ACTIVE') {
      throw appErrors.forbidden('ACCOUNT_DISABLED', 'Compte désactivé');
    }
    const membership = user
      ? await this.prisma.membership.findUnique({
          where: { userId_traiteurId: { userId: user.id, traiteurId: traiteur.id } },
        })
      : null;

    if (user?.isSuperAdmin || (membership && membership.role !== 'CLIENT')) {
      await this.otp.consumeCode(otpId);
      throw appErrors.forbidden(
        'USE_BACKOFFICE',
        "Ce compte fait partie de l'équipe : connectez-vous à l'espace de gestion",
      );
    }
    if (user && membership) return this.signIn(user, membership, input, otpId, client);
    return this.signUp(traiteur.id, user, input, codeEmailAddress, otpId, client);
  }

  // ─────────────────────────── Interne ───────────────────────────

  /** Client connu de ce traiteur ; une fiche créée au back-office donne d'abord son accord. */
  private async signIn(
    user: User,
    membership: Membership,
    input: ApiClientVerifyInput,
    otpId: string,
    client: ClientInfo,
  ): Promise<AuthSession> {
    if (membership.status === 'SUSPENDED') {
      throw appErrors.forbidden('MEMBERSHIP_INACTIVE', 'Votre accès à ce traiteur est suspendu');
    }
    const consent = membership.privacyConsentAt === null ? input.consent : undefined;
    if (membership.privacyConsentAt === null) {
      if (!consent) {
        throw appErrors.badRequest(
          'CONSENT_REQUIRED',
          'Acceptez la politique de confidentialité pour continuer',
          { firstName: membership.firstName },
        );
      }
      await this.assertPrivacyVersion(membership.traiteurId, consent.privacyVersion);
    }
    await this.otp.consumeCode(otpId);
    if (consent || membership.status === 'INVITED') {
      await this.prisma.membership.update({
        where: { id: membership.id },
        data: {
          status: 'ACTIVE',
          ...(consent
            ? {
                privacyConsentAt: new Date(),
                privacyPolicyVersion: consent.privacyVersion,
                privacyConsentIp: client.ipAddress,
              }
            : {}),
        },
      });
    }
    return this.auth.startClientSession(
      user,
      { traiteurId: membership.traiteurId, membershipId: membership.id, role: 'CLIENT' },
      client,
    );
  }

  /**
   * Inscription chez ce traiteur : compte créé si le numéro est inconnu, fiche client avec le
   * nom saisi ici (jamais celui connu ailleurs), consentement horodaté, accord du traiteur
   * demandé si son réglage l'exige.
   */
  private async signUp(
    traiteurId: string,
    existing: User | null,
    input: ApiClientVerifyInput,
    codeEmailAddress: string | null,
    otpId: string,
    client: ClientInfo,
  ): Promise<AuthSession> {
    const signup = input.signup;
    if (!signup) {
      throw appErrors.badRequest(
        'SIGNUP_REQUIRED',
        'Inscrivez-vous chez ce traiteur pour continuer',
      );
    }
    await this.assertPrivacyVersion(traiteurId, signup.privacyVersion);
    // Numéro étranger : l'adresse prouvée par le code ; sinon celle saisie (facultative)
    const email = codeEmailAddress ?? signup.email ?? null;
    let accountEmail: string | null = null;
    if (!existing && email) {
      const owner = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      // Adresse prouvée par le code mais déjà liée à un autre numéro : seul son titulaire le voit
      if (owner && codeEmailAddress) {
        throw appErrors.conflict('EMAIL_TAKEN', 'Cette adresse e-mail est liée à un autre numéro');
      }
      // Adresse saisie sans preuve : jamais d'erreur qui révélerait un compte ; gardée sur la
      // fiche de ce traiteur seulement
      accountEmail = owner ? null : email;
    }
    await this.otp.consumeCode(otpId);

    const { requireClientApproval } = await this.prisma.traiteur.findUniqueOrThrow({
      where: { id: traiteurId },
      select: { requireClientApproval: true },
    });
    const locale = signup.locale ?? 'fr';
    const now = new Date();
    const { user, membership, notificationId } = await this.prisma.$transaction(async (tx) => {
      const user =
        existing ??
        (await tx.user.create({
          data: {
            phone: input.phone,
            email: accountEmail,
            firstName: signup.firstName,
            lastName: signup.lastName,
            locale,
          },
        }));
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          traiteurId,
          role: 'CLIENT',
          firstName: signup.firstName,
          lastName: signup.lastName,
          email,
          locale,
          clientApproval: requireClientApproval ? 'PENDING' : 'APPROVED',
          privacyConsentAt: now,
          privacyPolicyVersion: signup.privacyVersion,
          privacyConsentIp: client.ipAddress,
        },
      });
      await this.audit.record(
        {
          traiteurId,
          actor: {
            userId: user.id,
            traiteurId,
            membershipId: membership.id,
            role: 'CLIENT',
            isSuperAdmin: false,
            platformAccessId: null,
          },
          action: 'client.self_registered',
          entityType: 'Membership',
          entityId: membership.id,
          after: {
            clientApproval: membership.clientApproval,
            privacyPolicyVersion: signup.privacyVersion,
          },
          client,
        },
        tx,
      );
      const notificationId = await this.notifications.record(tx, {
        traiteurId,
        type: requireClientApproval ? 'CLIENT_APPROVAL_REQUESTED' : 'CLIENT_SIGNED_UP',
        entityType: 'Membership',
        entityId: membership.id,
        data: { clientName: `${signup.firstName} ${signup.lastName}` },
      });
      return { user, membership, notificationId };
    });
    await this.notifications.dispatch([notificationId]);
    return this.auth.startClientSession(
      user,
      { traiteurId, membershipId: membership.id, role: 'CLIENT' },
      client,
    );
  }

  /** Politique acceptée = politique en vigueur ; sinon le site la recharge et la réaffiche. */
  private async assertPrivacyVersion(traiteurId: string, version: string): Promise<void> {
    const current = await this.site.privacyOf(traiteurId);
    if (current.version !== version) {
      throw appErrors.conflict(
        'PRIVACY_POLICY_CHANGED',
        'La politique de confidentialité a changé : relisez-la avant de continuer',
      );
    }
  }

  private requireEmail(email: string | undefined): string {
    if (!email) {
      throw appErrors.badRequest(
        'EMAIL_REQUIRED',
        'Ce numéro ne reçoit pas nos SMS : indiquez votre adresse e-mail pour recevoir le code',
      );
    }
    return email;
  }

  private async traiteur(slug: string): Promise<{ id: string; name: string }> {
    const traiteur = await this.prisma.traiteur.findUnique({
      where: { slug },
      select: { id: true, name: true, status: true },
    });
    if (!traiteur) throw appErrors.notFound('TRAITEUR_NOT_FOUND', 'Traiteur introuvable');
    if (traiteur.status === 'SUSPENDED' || traiteur.status === 'CANCELLED') {
      throw appErrors.forbidden(
        'TRAITEUR_UNAVAILABLE',
        'Ce traiteur est actuellement indisponible',
      );
    }
    return traiteur;
  }
}

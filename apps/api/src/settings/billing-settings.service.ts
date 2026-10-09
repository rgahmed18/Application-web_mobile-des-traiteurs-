import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  type BillingSettings,
  type BillingSettingsInput,
  parseLocalizedText,
} from '@traiteur/shared';
import sharp from 'sharp';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import { appErrors } from '../common/errors';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PRIVATE_PREFIX, StorageService } from '../storage/storage.service';

const select = {
  depositPercentBps: true,
  balanceDueDays: true,
  quoteValidityDays: true,
  cancellationFeeTaxRateBps: true,
  creditNoteNumbering: true,
  legalName: true,
  legalForm: true,
  shareCapital: true,
  ice: true,
  rcNumber: true,
  rcCourt: true,
  taxId: true,
  patenteNumber: true,
  cnssNumber: true,
  legalAddress: true,
  bankName: true,
  rib: true,
  invoiceFooter: true,
  quoteTerms: true,
  paymentTerms: true,
  isVatRegistered: true,
  defaultTaxRateBps: true,
  logoKey: true,
} satisfies Prisma.TraiteurSelect;
type Row = Prisma.TraiteurGetPayload<{ select: typeof select }>;

/** Logo des documents : 5 Mo au plus, converti en PNG (fond conservé), 600 px de haut au plus. */
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const terms = (value: Prisma.JsonValue | null) =>
  value === null ? null : parseLocalizedText(value);
const json = (value: BillingSettingsInput['quoteTerms']) =>
  value === null ? Prisma.DbNull : { ...value };

/** Réglages « Documents et paiements » : échéancier, devis, numérotation, mentions légales. */
@Injectable()
export class BillingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async get(user: AuthenticatedUser): Promise<BillingSettings> {
    const traiteurId = requireTraiteurId(user);
    return this.toSettings(
      await this.prisma.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select }),
    );
  }

  async update(
    user: AuthenticatedUser,
    input: BillingSettingsInput,
    client: ClientInfo,
  ): Promise<BillingSettings> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select });
      const after = await tx.traiteur.update({
        where: { id: traiteurId },
        data: {
          ...input,
          quoteTerms: json(input.quoteTerms),
          paymentTerms: json(input.paymentTerms),
        },
        select,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'settings.billing_updated',
          entityType: 'Traiteur',
          entityId: traiteurId,
          before: this.toSettings(before),
          after: this.toSettings(after),
          client,
        },
        tx,
      );
      return this.toSettings(after);
    });
  }

  async setLogo(
    user: AuthenticatedUser,
    file: { buffer: Buffer; size: number } | undefined,
    client: ClientInfo,
  ): Promise<BillingSettings> {
    const traiteurId = requireTraiteurId(user);
    if (!file || file.size === 0) throw appErrors.badRequest('LOGO_INVALID', 'Fichier manquant');
    if (file.size > MAX_LOGO_BYTES)
      throw appErrors.badRequest('IMAGE_TOO_LARGE', 'Logo trop lourd (5 Mo au plus)');
    let png: Buffer;
    try {
      png = await sharp(file.buffer)
        .rotate()
        .resize({ height: 600, withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch {
      throw appErrors.badRequest('LOGO_INVALID', 'Image illisible (PNG, JPEG ou WebP attendu)');
    }
    const key = `${PRIVATE_PREFIX}traiteurs/${traiteurId}/branding/logo-${randomUUID()}.png`;
    await this.storage.putPrivate(key, png, 'image/png');
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.traiteur.update({
        where: { id: traiteurId },
        data: { logoKey: key },
        select,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'settings.logo_updated',
          entityType: 'Traiteur',
          entityId: traiteurId,
          after: { logoKey: key },
          client,
        },
        tx,
      );
      return updated;
    });
    // L'ancien logo reste stocké : les documents déjà émis sont figés dans leur PDF
    return this.toSettings(after);
  }

  async removeLogo(user: AuthenticatedUser, client: ClientInfo): Promise<BillingSettings> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.traiteur.update({
        where: { id: traiteurId },
        data: { logoKey: null },
        select,
      });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action: 'settings.logo_removed',
          entityType: 'Traiteur',
          entityId: traiteurId,
          client,
        },
        tx,
      );
      return this.toSettings(updated);
    });
  }

  private toSettings(row: Row): BillingSettings {
    const { logoKey, quoteTerms, paymentTerms, ...rest } = row;
    return {
      ...rest,
      quoteTerms: terms(quoteTerms),
      paymentTerms: terms(paymentTerms),
      hasLogo: logoKey !== null,
    };
  }
}

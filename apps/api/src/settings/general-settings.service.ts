import { Injectable } from '@nestjs/common';
import type {
  AvailabilitySettings,
  CompanySettings,
  PricingSettings,
  PricingSettingsInput,
} from '@traiteur/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth-user';
import type { ClientInfo } from '../common/http/client-info';
import { requireTraiteurId } from '../common/tenant';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const companySelect = {
  name: true,
  email: true,
  phone: true,
  city: true,
} satisfies Prisma.TraiteurSelect;

const availabilitySelect = {
  maxEventsPerDay: true,
  closedWeekdays: true,
  missionRedactionDays: true,
} satisfies Prisma.TraiteurSelect;

const pricingSelect = {
  priceEntryMode: true,
  isVatRegistered: true,
  defaultTaxRateBps: true,
} satisfies Prisma.TraiteurSelect;

/** Réglages lus (texte, nombres, listes de nombres) : valeurs JSON telles quelles pour l'audit. */
const snapshot = (value: object) => ({ ...value }) as Prisma.InputJsonObject;

/**
 * Paramètres généraux du traiteur : entreprise (coordonnées), disponibilités (capacité par jour,
 * fermeture hebdomadaire, masquage des missions terminées) et mode de saisie des prix. Chaque
 * modification est tracée avec l'état avant et après.
 */
@Injectable()
export class GeneralSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  company(user: AuthenticatedUser): Promise<CompanySettings> {
    return this.read(user, companySelect);
  }

  updateCompany(
    user: AuthenticatedUser,
    input: CompanySettings,
    client: ClientInfo,
  ): Promise<CompanySettings> {
    return this.write(user, companySelect, input, 'settings.company_updated', client);
  }

  availability(user: AuthenticatedUser): Promise<AvailabilitySettings> {
    return this.read(user, availabilitySelect);
  }

  updateAvailability(
    user: AuthenticatedUser,
    input: AvailabilitySettings,
    client: ClientInfo,
  ): Promise<AvailabilitySettings> {
    return this.write(user, availabilitySelect, input, 'settings.availability_updated', client);
  }

  pricing(user: AuthenticatedUser): Promise<PricingSettings> {
    return this.read(user, pricingSelect);
  }

  /**
   * Mode de saisie des prix : s'applique aux nouveaux prix et aux nouveaux documents. Les
   * commandes, devis et factures existants gardent le mode figé à leur création ; le catalogue
   * stocke déjà HT et TTC.
   */
  updatePricing(
    user: AuthenticatedUser,
    input: PricingSettingsInput,
    client: ClientInfo,
  ): Promise<PricingSettings> {
    return this.write(user, pricingSelect, input, 'settings.pricing_updated', client);
  }

  // ─────────────────────────── Interne ───────────────────────────

  private async read<TSelect extends Prisma.TraiteurSelect>(
    user: AuthenticatedUser,
    select: TSelect,
  ): Promise<Prisma.TraiteurGetPayload<{ select: TSelect }>> {
    return this.prisma.traiteur.findUniqueOrThrow({
      where: { id: requireTraiteurId(user) },
      select,
    });
  }

  private async write<TSelect extends Prisma.TraiteurSelect>(
    user: AuthenticatedUser,
    select: TSelect,
    data: Prisma.TraiteurUpdateInput,
    action: string,
    client: ClientInfo,
  ): Promise<Prisma.TraiteurGetPayload<{ select: TSelect }>> {
    const traiteurId = requireTraiteurId(user);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.traiteur.findUniqueOrThrow({ where: { id: traiteurId }, select });
      const after = await tx.traiteur.update({ where: { id: traiteurId }, data, select });
      await this.audit.record(
        {
          traiteurId,
          actor: user,
          action,
          entityType: 'Traiteur',
          entityId: traiteurId,
          before: snapshot(before),
          after: snapshot(after),
          client,
        },
        tx,
      );
      return after;
    });
  }
}

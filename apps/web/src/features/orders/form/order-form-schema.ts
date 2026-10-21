import {
  computeDocumentTotals,
  computeLineAmounts,
  type DocumentTotals,
  eventTypeSchema,
  lineItemTypeSchema,
  type LineAmounts,
  type LocalizedText,
  type Order,
  orderCreateSchema,
  type PriceMode,
} from '@traiteur/shared';
import { z } from 'zod';

import { amountToCents, centsToAmount, toInteger } from '@/features/catalog/forms/form-values';

/**
 * Formulaire de commande : valeurs saisies (textes), transformées puis validées par le schéma
 * partagé de l'API (orderCreateSchema) — mêmes règles, mêmes chemins d'erreur.
 */

export const lineFormSchema = z.object({
  /** Identifiant local (clé React) : les lignes n'ont pas d'identifiant stable côté API. */
  key: z.string(),
  itemType: lineItemTypeSchema,
  dishId: z.string().nullable(),
  packageId: z.string().nullable(),
  extraServiceId: z.string().nullable(),
  equipmentId: z.string().nullable(),
  buffetId: z.string().nullable(),
  /** Libellé dans toutes les langues (copie du catalogue) ; une ligne libre : fr et/ou ar. */
  label: z.object({ fr: z.string(), ar: z.string(), en: z.string() }),
  quantity: z.string(),
  /** Prix unitaire dans le mode de prix de la commande. */
  unitPrice: z.string(),
  /** Remise : montant (« 200 ») ou pourcentage du montant brut (« 10 % »). */
  discount: z.string(),
  taxRateBps: z.string(),
  perPerson: z.boolean(),
  notes: z.string(),
});
export type LineFormValues = z.infer<typeof lineFormSchema>;

const PERCENT = /^\s*(\d+(?:[.,]\d+)?)\s*%\s*$/;

/** Remise saisie → centimes : « 10 % » du montant brut, ou un montant ; NaN si illisible. */
export function discountToCents(discount: string, unitPrice: number, quantity: number): number {
  if (discount.trim() === '') return 0;
  const percent = PERCENT.exec(discount);
  if (percent) {
    const rate = Number((percent[1] ?? '').replace(',', '.'));
    if (!Number.isFinite(rate) || rate > 100) return Number.NaN;
    return Math.round((unitPrice * quantity * rate) / 100);
  }
  return amountToCents(discount);
}

/** Délai saisi : vide → réglage du traiteur (null), sinon un entier (NaN refusé par l'API). */
function optionalHours(value: string): number | null {
  return value.trim() === '' ? null : toInteger(value);
}

export const orderFormSchema = z
  .object({
    /** Statut demandé (création) ; pour une modification, sert seulement à la validation. */
    status: z.enum(['DRAFT', 'PENDING', 'CONFIRMED']),
    clientId: z.string(),
    eventType: eventTypeSchema,
    eventDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    endsNextDay: z.boolean(),
    guestCount: z.string(),
    venueName: z.string(),
    venueAddress: z.string(),
    city: z.string(),
    notes: z.string(),
    internalNotes: z.string(),
    /** Délais du matériel en heures ; vide : réglage du traiteur. */
    equipmentSetupHours: z.string(),
    equipmentReturnHours: z.string(),
    lines: z.array(lineFormSchema),
  })
  // Sortie typée comme l'entrée du schéma de l'API (champs à valeur par défaut compris)
  .transform((values): z.input<typeof orderCreateSchema> => ({
    status: values.status,
    forceAvailability: false,
    stockOverrideReason: null,
    clientId: values.clientId,
    eventType: values.eventType,
    eventDate: values.eventDate,
    startTime: values.startTime,
    endTime: values.endTime.trim() === '' ? null : values.endTime,
    endsNextDay: values.endTime.trim() === '' ? false : values.endsNextDay,
    guestCount: toInteger(values.guestCount),
    venueName: values.venueName.trim() === '' ? null : values.venueName,
    venueAddress: values.venueAddress,
    city: values.city,
    notes: values.notes.trim() === '' ? null : values.notes,
    internalNotes: values.internalNotes.trim() === '' ? null : values.internalNotes,
    equipmentSetupHours: optionalHours(values.equipmentSetupHours),
    equipmentReturnHours: optionalHours(values.equipmentReturnHours),
    lines: values.lines.map((line) => {
      const unitPrice = amountToCents(line.unitPrice);
      const quantity = toInteger(line.quantity);
      return {
        itemType: line.itemType,
        dishId: line.dishId,
        packageId: line.packageId,
        extraServiceId: line.extraServiceId,
        equipmentId: line.equipmentId,
        buffetId: line.buffetId,
        // Traductions vides ignorées par le schéma partagé (repli sur le texte disponible)
        label: line.label,
        quantity,
        unitPrice,
        discount: discountToCents(line.discount, unitPrice, quantity),
        taxRateBps: Number(line.taxRateBps),
        perPerson: line.perPerson,
        notes: line.notes.trim() === '' ? null : line.notes,
      };
    }),
  }))
  .pipe(orderCreateSchema);

export type OrderFormValues = z.input<typeof orderFormSchema>;
export type OrderFormOutput = z.output<typeof orderFormSchema>;

/** Libellé enregistré (ou nom du catalogue) → champs du formulaire. */
export function formLabel(label: LocalizedText): LineFormValues['label'] {
  return { fr: label.fr, ar: label.ar ?? '', en: label.en ?? '' };
}

/** Libellé affiché dans l'interface : langue de l'utilisateur, sinon le texte disponible. */
export function formLabelText(label: LineFormValues['label'], locale: string): string {
  const preferred = locale === 'ar' ? label.ar : locale === 'en' ? label.en : label.fr;
  return preferred.trim() || label.fr.trim() || label.ar.trim() || label.en.trim();
}

let keySequence = 0;
export const newLineKey = () => `line-${Date.now().toString(36)}-${(keySequence += 1)}`;

export function emptyOrderForm(date: string, clientId: string): OrderFormValues {
  return {
    status: 'PENDING',
    clientId,
    eventType: 'WEDDING',
    eventDate: date,
    startTime: '19:00',
    endTime: '',
    endsNextDay: false,
    guestCount: '',
    venueName: '',
    venueAddress: '',
    city: '',
    notes: '',
    internalNotes: '',
    equipmentSetupHours: '',
    equipmentReturnHours: '',
    lines: [],
  };
}

/** Commande existante → valeurs du formulaire (montants dans le mode de prix de la commande). */
export function orderToFormValues(order: Order): OrderFormValues {
  return {
    status: order.status === 'DRAFT' ? 'DRAFT' : 'PENDING',
    clientId: order.client.id,
    eventType: order.eventType,
    eventDate: order.eventDate,
    startTime: order.startTime,
    endTime: order.endTime ?? '',
    endsNextDay: order.endsNextDay,
    guestCount: String(order.guestCount),
    venueName: order.venueName ?? '',
    venueAddress: order.venueAddress,
    city: order.city,
    notes: order.notes ?? '',
    internalNotes: order.internalNotes ?? '',
    equipmentSetupHours:
      order.equipmentSetupHours === null ? '' : String(order.equipmentSetupHours),
    equipmentReturnHours:
      order.equipmentReturnHours === null ? '' : String(order.equipmentReturnHours),
    lines: order.lines.map((line) => ({
      key: line.id,
      itemType: line.itemType,
      dishId: line.dishId,
      packageId: line.packageId,
      extraServiceId: line.extraServiceId,
      equipmentId: line.equipmentId,
      buffetId: line.buffetId,
      label: formLabel(line.label),
      quantity: String(line.quantity),
      unitPrice: centsToAmount(line.unitPrice),
      discount: line.discount === 0 ? '' : centsToAmount(line.discount),
      taxRateBps: String(line.taxRateBps),
      perPerson: line.perPerson,
      notes: line.notes ?? '',
    })),
  };
}

/** Montants d'une ligne en cours de saisie ; null tant qu'elle est incomplète ou invalide. */
export function lineAmounts(priceMode: PriceMode, line: LineFormValues): LineAmounts | null {
  const unitPrice = amountToCents(line.unitPrice);
  const quantity = toInteger(line.quantity);
  const taxRateBps = Number(line.taxRateBps);
  if (!Number.isFinite(unitPrice) || !Number.isFinite(quantity) || quantity < 1) return null;
  const discount = discountToCents(line.discount, unitPrice, quantity);
  if (!Number.isFinite(discount)) return null;
  try {
    return priceMode === 'TTC'
      ? computeLineAmounts({
          priceMode,
          unitPriceTtc: unitPrice,
          discountTtc: discount,
          quantity,
          taxRateBps,
        })
      : computeLineAmounts({
          priceMode,
          unitPriceHt: unitPrice,
          discountHt: discount,
          quantity,
          taxRateBps,
        });
  } catch {
    return null;
  }
}

/** Totaux en direct : exactement le calcul de l'API (somme des lignes arrondies). */
export function liveTotals(priceMode: PriceMode, lines: readonly LineFormValues[]): DocumentTotals {
  return computeDocumentTotals(
    lines.flatMap((line) => {
      const amounts = lineAmounts(priceMode, line);
      return amounts ? [amounts] : [];
    }),
  );
}

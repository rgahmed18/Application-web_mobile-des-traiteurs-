import { getLocalizedText, type LocalizedText, localizedTextSchema } from '@traiteur/shared';

import { readLineLabel } from '../documents/line-label';
import type { Prisma } from '../generated/prisma/client';
import { auto, type DocumentModel, ltr } from '../pdf/document-model';
import { type DocLocale, localDate } from '../pdf/format';
import { docLabels } from '../pdf/labels';
import { type Seller, sellerHeader } from '../pdf/seller';

/**
 * Bon de préparation pour la cuisine (par événement ou par jour), sans aucun prix : quantités
 * totales par plat, regroupées par catégorie (entrées, plats, desserts, boissons…). Les formules
 * sont décomposées en plats (quantité par personne × nombre de la ligne, composition actuelle).
 */
export type PrepUnit = 'PER_PERSON' | 'PER_PIECE' | 'PER_PLATTER' | 'PER_KG' | 'UNIT';

export interface PrepItem {
  key: string;
  label: LocalizedText;
  category: { name: LocalizedText; sortOrder: number } | null;
  quantity: number;
  unit: PrepUnit;
}

export interface PrepOrder {
  reference: string;
  eventType: 'WEDDING' | 'ENGAGEMENT' | 'BIRTHDAY' | 'AQIQA' | 'CORPORATE' | 'OTHER';
  date: string;
  startTime: string;
  guestCount: number;
  city: string;
  items: PrepItem[];
}

const dishSelect = {
  id: true,
  name: true,
  unit: true,
  category: { select: { name: true, sortOrder: true } },
} satisfies Prisma.DishSelect;

/** Lignes de commande nécessaires au bon (catalogue actuel pour la composition des formules). */
export const preparationItemsInclude = {
  items: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      itemType: true,
      label: true,
      quantity: true,
      dishId: true,
      dish: { select: dishSelect },
      package: {
        select: {
          dishes: {
            orderBy: { sortOrder: 'asc' },
            select: { quantity: true, dish: { select: dishSelect } },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;
type PrepRow = Prisma.OrderGetPayload<{ include: typeof preparationItemsInclude }>;

function localized(value: Prisma.JsonValue): LocalizedText {
  const parsed = localizedTextSchema.safeParse(value);
  return parsed.success ? parsed.data : { fr: '—' };
}

/** Plats à préparer pour une commande (services exclus : ils ne passent pas en cuisine). */
export function preparationItems(row: Pick<PrepRow, 'items'>): PrepItem[] {
  const items: PrepItem[] = [];
  const dishItem = (
    dish: NonNullable<PrepRow['items'][number]['dish']>,
    quantity: number,
  ): PrepItem => ({
    key: `dish:${dish.id}`,
    label: localized(dish.name),
    category: dish.category
      ? { name: localized(dish.category.name), sortOrder: dish.category.sortOrder }
      : null,
    quantity,
    unit: dish.unit,
  });
  for (const line of row.items) {
    if (line.itemType === 'DISH' && line.dish) {
      // Libellé figé de la ligne, complété par le catalogue pour les langues qui lui manquent
      const item = dishItem(line.dish, line.quantity);
      items.push({ ...item, label: { ...item.label, ...readLineLabel(line.label) } });
    } else if (line.itemType === 'PACKAGE' && line.package) {
      for (const component of line.package.dishes) {
        items.push(dishItem(component.dish, component.quantity * line.quantity));
      }
    } else if (line.itemType === 'CUSTOM') {
      const label = readLineLabel(line.label);
      items.push({
        key: `custom:${label.fr}`,
        label,
        category: null,
        quantity: line.quantity,
        unit: 'UNIT',
      });
    }
  }
  return items;
}

/** Quantités totales par plat, dans l'ordre des catégories puis des libellés. */
export function aggregate(items: readonly PrepItem[], locale: DocLocale): PrepItem[] {
  const byKey = new Map<string, PrepItem>();
  for (const item of items) {
    const current = byKey.get(`${item.key}|${item.unit}`);
    byKey.set(
      `${item.key}|${item.unit}`,
      current ? { ...current, quantity: current.quantity + item.quantity } : { ...item },
    );
  }
  return [...byKey.values()].sort(
    (a, b) =>
      (a.category?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.category?.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
      getLocalizedText(a.category?.name ?? { fr: '' }, locale).localeCompare(
        getLocalizedText(b.category?.name ?? { fr: '' }, locale),
      ) ||
      getLocalizedText(a.label, locale).localeCompare(getLocalizedText(b.label, locale)),
  );
}

export function preparationDocument(data: {
  locale: DocLocale;
  seller: Seller;
  hasLogo: boolean;
  /** Un seul événement, ou tous les événements du jour. */
  scope: 'event' | 'day';
  day: string;
  orders: PrepOrder[];
}): DocumentModel {
  const { locale } = data;
  const t = docLabels(locale);
  const quantity = (item: PrepItem) =>
    item.unit === 'UNIT' ? ltr(item.quantity) : `${ltr(item.quantity)} ${t.units[item.unit]}`;
  const totals = aggregate(
    data.orders.flatMap((order) => order.items),
    locale,
  );
  let previous: string | null = null;
  const rows = totals.map((item) => {
    const category = getLocalizedText(
      item.category?.name ?? { fr: t.otherCategory, ar: t.otherCategory },
      locale,
    );
    const shown = category === previous ? '' : category;
    previous = category;
    return [auto(shown), auto(getLocalizedText(item.label, locale)), quantity(item)];
  });
  const describe = (order: PrepOrder) =>
    `${ltr(order.reference)} — ${ltr(order.startTime)} — ${t.eventTypes[order.eventType]} — ${t.guests(order.guestCount)} — ${auto(order.city)}`;
  const single = data.scope === 'event' ? data.orders[0] : undefined;

  return {
    lang: locale,
    title: t.preparationSheet,
    number: single ? single.reference : localDate(data.day),
    hasLogo: data.hasLogo,
    watermark: null,
    meta: [
      [t.date, localDate(data.day)],
      ...(single ? [] : ([[t.event, t.eventsOfDay(data.orders.length)]] as [string, string][])),
    ],
    seller: sellerHeader(data.seller),
    parties: single
      ? [
          {
            title: t.event,
            lines: [
              `${t.eventTypes[single.eventType]} — ${t.guests(single.guestCount)}`,
              `${localDate(single.date)} ${ltr(single.startTime)}`,
              auto(single.city),
            ],
          },
        ]
      : [],
    table: {
      columns: [
        { label: t.category, align: 'start', width: 'auto' },
        { label: t.dish, align: 'start', width: 'fill' },
        { label: t.totalQuantity, align: 'end', width: 'auto' },
      ],
      rows,
    },
    sections: single
      ? []
      : [
          { title: t.byEvent, items: [], bullets: false },
          ...data.orders.map((order) => ({
            title: describe(order),
            items: aggregate(order.items, locale).map(
              (item) => `${auto(getLocalizedText(item.label, locale))} : ${quantity(item)}`,
            ),
          })),
        ],
    signature: null,
    footer: [auto(data.seller.legalName ?? data.seller.name)],
  };
}

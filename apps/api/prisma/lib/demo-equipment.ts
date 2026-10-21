/**
 * Matériel, buffets et menus classés (gamme, types d'événement) du traiteur de démonstration,
 * puis trois commandes qui les utilisent : une soutenance, un mariage qui mobilise la plupart des
 * chaises et des fiançailles en attente le même soir (stock insuffisant à la confirmation).
 * Idempotent : articles mis à jour par leur slug, commandes créées une seule fois.
 */
import {
  addDays,
  computeCatalogPrices,
  type LocalizedText,
  type OrderStatus,
  type PriceMode,
  unitPriceFor,
  zonedToUtc,
} from '@traiteur/shared';

import type { LineDraft } from '../../src/documents/document-lines';
import { addDocumentLines } from '../../src/documents/document-lines';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { nextDocumentNumber } from '../../src/sequences/document-sequence';

const TAX_RATE = 2000;
const MARKER = 'Démo matériel #';
const DH = (amount: number) => Math.round(amount * 100);

interface EquipmentSeed {
  slug: string;
  name: LocalizedText;
  description: LocalizedText | null;
  category: string;
  range: string | null;
  ttc: number;
  replacementTtc: number;
  stock: number;
}

const EQUIPMENT: EquipmentSeed[] = [
  {
    slug: 'chaise-napoleon',
    name: { fr: 'Chaise Napoléon dorée', ar: 'كرسي نابليون ذهبي' },
    description: { fr: 'Chaise de cérémonie, coussin blanc.', ar: 'كرسي للحفلات بوسادة بيضاء.' },
    category: 'CHAIRS',
    range: 'PREMIUM',
    ttc: 15,
    replacementTtc: 450,
    stock: 300,
  },
  {
    slug: 'table-ronde-10',
    name: { fr: 'Table ronde 10 personnes', ar: 'طاولة مستديرة لعشرة أشخاص' },
    description: null,
    category: 'TABLES',
    range: 'STANDARD',
    ttc: 80,
    replacementTtc: 1_800,
    stock: 40,
  },
  {
    slug: 'nappe-blanche',
    name: { fr: 'Nappe blanche brodée', ar: 'مفرش أبيض مطرز' },
    description: null,
    category: 'LINENS',
    range: 'STANDARD',
    ttc: 25,
    replacementTtc: 300,
    stock: 60,
  },
  {
    slug: 'housse-chaise',
    name: { fr: 'Housse de chaise satin', ar: 'غطاء كرسي من الساتان' },
    description: null,
    category: 'COVERS',
    range: 'PREMIUM',
    ttc: 8,
    replacementTtc: 90,
    stock: 300,
  },
  {
    slug: 'chauffe-plat-inox',
    name: { fr: 'Chauffe-plat inox', ar: 'سخان أطباق من الإينوكس' },
    description: null,
    category: 'TABLEWARE',
    range: null,
    ttc: 60,
    replacementTtc: 900,
    stock: 20,
  },
  {
    slug: 'arche-florale',
    name: { fr: 'Arche florale des mariés', ar: 'قوس الورود للعروسين' },
    description: { fr: 'Arche fleurie montée sur place.', ar: 'قوس ورود يركب في عين المكان.' },
    category: 'FLORAL',
    range: 'LUXE',
    ttc: 1_500,
    replacementTtc: 12_000,
    stock: 2,
  },
];

interface BuffetSeed {
  slug: string;
  name: LocalizedText;
  description: LocalizedText | null;
  type: string;
  range: string | null;
  pricingUnit: 'PER_PERSON' | 'FLAT';
  ttc: number;
  minGuests: number;
  dishes: [string, number][];
  freeItems: LocalizedText[];
}

const BUFFETS: BuffetSeed[] = [
  {
    slug: 'buffet-marocain-premium',
    name: { fr: 'Buffet marocain', ar: 'بوفيه مغربي' },
    description: {
      fr: 'Salades, pastilla et poulet m’hammer, servis en buffet.',
      ar: 'سلطات وبسطيلة ودجاج محمر في بوفيه.',
    },
    type: 'MOROCCAN',
    range: 'PREMIUM',
    pricingUnit: 'PER_PERSON',
    ttc: 220,
    minGuests: 40,
    dishes: [
      ['salades-marocaines', 1],
      ['pastilla-poulet', 1],
      ['poulet-mhammer', 1],
    ],
    freeItems: [{ fr: 'Pain maison et olives', ar: 'خبز منزلي وزيتون' }],
  },
  {
    slug: 'buffet-sucre',
    name: { fr: 'Buffet sucré', ar: 'بوفيه الحلويات' },
    description: { fr: 'Pâtisseries marocaines et fruits.', ar: 'حلويات مغربية وفواكه.' },
    type: 'SWEET',
    range: 'STANDARD',
    pricingUnit: 'PER_PERSON',
    ttc: 70,
    minGuests: 30,
    dishes: [
      ['cornes-de-gazelle', 2],
      ['chebakia', 2],
      ['plateau-fruits', 1],
    ],
    freeItems: [],
  },
  {
    slug: 'buffet-the',
    name: { fr: 'Buffet thé et msemen', ar: 'بوفيه أتاي ومسمن' },
    description: {
      fr: 'Thé à la menthe, msemen, beghrir et ghriba, prix forfaitaire.',
      ar: 'أتاي بالنعناع ومسمن وبغرير وغريبة، بثمن جزافي.',
    },
    type: 'TEA',
    range: null,
    pricingUnit: 'FLAT',
    ttc: 2_400,
    minGuests: 1,
    dishes: [
      ['the-menthe', 1],
      ['ghriba-amandes', 2],
    ],
    freeItems: [
      { fr: 'Msemen et beghrir', ar: 'مسمن وبغرير' },
      { fr: 'Amlou et miel', ar: 'أملو وعسل' },
    ],
  },
];

/** Gamme et types d'événement des menus de démonstration. */
const PACKAGE_AUDIENCE: Record<string, { range: string; eventTypes: string[] }> = {
  'formule-fiancailles': { range: 'PREMIUM', eventTypes: ['ENGAGEMENT'] },
  'formule-mariage-prestige': { range: 'LUXE', eventTypes: ['WEDDING'] },
  'formule-aqiqa': { range: 'STANDARD', eventTypes: ['AQIQA', 'BIRTHDAY'] },
};

type Line =
  | { equipment: string; quantity: number }
  | { buffet: string; quantity?: number }
  | { package: string };

interface OrderSpec {
  clientPhone: string;
  type: string;
  date: string;
  start: string;
  end: string;
  nextDay?: boolean;
  guests: number;
  venue: string;
  city: string;
  status: OrderStatus;
  lines: Line[];
  setupHours?: number;
}

const ORDERS: OrderSpec[] = [
  {
    clientPhone: '+212661000008',
    type: 'THESIS',
    date: '2026-11-12',
    start: '17:00',
    end: '20:00',
    guests: 60,
    venue: 'Faculté des sciences Aïn Chock',
    city: 'Casablanca',
    status: 'CONFIRMED',
    setupHours: 3,
    lines: [
      { buffet: 'buffet-the' },
      { buffet: 'buffet-sucre' },
      { equipment: 'table-ronde-10', quantity: 6 },
      { equipment: 'nappe-blanche', quantity: 6 },
    ],
  },
  {
    clientPhone: '+212661000006',
    type: 'WEDDING',
    date: '2026-11-21',
    start: '20:00',
    end: '02:00',
    nextDay: true,
    guests: 250,
    venue: 'Palais Bab Jdid',
    city: 'Marrakech',
    status: 'CONFIRMED',
    lines: [
      { package: 'formule-mariage-prestige' },
      { equipment: 'chaise-napoleon', quantity: 250 },
      { equipment: 'housse-chaise', quantity: 250 },
      { equipment: 'table-ronde-10', quantity: 25 },
      { equipment: 'chauffe-plat-inox', quantity: 12 },
      { equipment: 'arche-florale', quantity: 1 },
    ],
  },
  {
    // Même soir que le mariage : il ne reste que 50 chaises, la confirmation demandera un motif
    clientPhone: '+212661000002',
    type: 'ENGAGEMENT',
    date: '2026-11-21',
    start: '19:00',
    end: '23:30',
    guests: 120,
    venue: 'Riad Al Andalous',
    city: 'Rabat',
    status: 'PENDING',
    lines: [{ buffet: 'buffet-marocain-premium' }, { equipment: 'chaise-napoleon', quantity: 120 }],
  },
];

const prices = (ttc: number) => computeCatalogPrices(DH(ttc), 'TTC', TAX_RATE);

/** Matériel, buffets, gammes et types d'événement des menus. */
export async function seedDemoEquipmentAndBuffets(
  prisma: PrismaClient,
  traiteurId: string,
  dishIds: Map<string, string>,
  packageIds: Map<string, string>,
): Promise<{ equipmentIds: Map<string, string>; buffetIds: Map<string, string> }> {
  const listId = async (
    table: 'catalogRange' | 'eventType' | 'equipmentCategory' | 'buffetType',
    code: string,
  ): Promise<string> => {
    const where = { traiteurId_code: { traiteurId, code } };
    const row =
      table === 'catalogRange'
        ? await prisma.catalogRange.findUnique({ where })
        : table === 'eventType'
          ? await prisma.eventType.findUnique({ where })
          : table === 'equipmentCategory'
            ? await prisma.equipmentCategory.findUnique({ where })
            : await prisma.buffetType.findUnique({ where });
    if (!row) throw new Error(`Élément de liste inconnu : ${table} ${code}`);
    return row.id;
  };

  for (const [slug, audience] of Object.entries(PACKAGE_AUDIENCE)) {
    const packageId = packageIds.get(slug);
    if (!packageId) continue;
    await prisma.package.update({
      where: { id: packageId },
      data: { rangeId: await listId('catalogRange', audience.range) },
    });
    for (const code of audience.eventTypes) {
      const eventTypeId = await listId('eventType', code);
      await prisma.packageEventType.upsert({
        where: { packageId_eventTypeId: { packageId, eventTypeId } },
        update: {},
        create: { traiteurId, packageId, eventTypeId },
      });
    }
  }

  const equipmentIds = new Map<string, string>();
  for (const item of EQUIPMENT) {
    const replacement = prices(item.replacementTtc);
    const data = {
      name: item.name,
      description: item.description ?? undefined,
      categoryId: await listId('equipmentCategory', item.category),
      rangeId: item.range ? await listId('catalogRange', item.range) : null,
      ...prices(item.ttc),
      replacementPriceHt: replacement.priceHt,
      replacementPriceTtc: replacement.priceTtc,
      stockQuantity: item.stock,
    };
    const row = await prisma.equipmentItem.upsert({
      where: { traiteurId_slug: { traiteurId, slug: item.slug } },
      update: data,
      create: { traiteurId, slug: item.slug, ...data },
    });
    equipmentIds.set(item.slug, row.id);
  }

  const buffetIds = new Map<string, string>();
  for (const buffet of BUFFETS) {
    const data = {
      name: buffet.name,
      description: buffet.description ?? undefined,
      typeId: await listId('buffetType', buffet.type),
      rangeId: buffet.range ? await listId('catalogRange', buffet.range) : null,
      pricingUnit: buffet.pricingUnit,
      ...prices(buffet.ttc),
      minGuests: buffet.minGuests,
      freeItems: buffet.freeItems,
    };
    const row = await prisma.buffet.upsert({
      where: { traiteurId_slug: { traiteurId, slug: buffet.slug } },
      update: data,
      create: { traiteurId, slug: buffet.slug, ...data },
    });
    buffetIds.set(buffet.slug, row.id);
    for (const [index, [dishSlug, quantity]] of buffet.dishes.entries()) {
      const dishId = dishIds.get(dishSlug);
      if (!dishId) throw new Error(`Plat inconnu dans le buffet : ${dishSlug}`);
      await prisma.buffetDish.upsert({
        where: { buffetId_dishId: { buffetId: row.id, dishId } },
        update: { quantity, sortOrder: index },
        create: { traiteurId, buffetId: row.id, dishId, quantity, sortOrder: index },
      });
    }
  }

  console.log(
    `✓ Matériel (${EQUIPMENT.length} articles), buffets (${BUFFETS.length}), gammes et types d’événement des menus`,
  );
  return { equipmentIds, buffetIds };
}

/** Commandes avec matériel et buffets (soutenance, mariage, fiançailles en attente). */
export async function seedDemoEquipmentOrders(
  prisma: PrismaClient,
  traiteur: { id: string; timezone: string; priceEntryMode: PriceMode },
  adminUserId: string,
  ids: {
    equipmentIds: Map<string, string>;
    buffetIds: Map<string, string>;
    packageIds: Map<string, string>;
  },
): Promise<void> {
  const traiteurId = traiteur.id;
  if (await prisma.order.count({ where: { traiteurId, internalNotes: { startsWith: MARKER } } })) {
    console.log(`✓ ${ORDERS.length} commandes avec matériel et buffets déjà présentes`);
    return;
  }
  const admin = await prisma.membership.findUniqueOrThrow({
    where: { userId_traiteurId: { userId: adminUserId, traiteurId } },
    select: { firstName: true, lastName: true },
  });
  const actorName = `${admin.firstName} ${admin.lastName}`;
  const unitPrice = (ttc: number) => unitPriceFor(prices(ttc), traiteur.priceEntryMode);

  for (const [index, spec] of ORDERS.entries()) {
    const client = await prisma.membership.findFirstOrThrow({
      where: { traiteurId, role: 'CLIENT', user: { phone: spec.clientPhone } },
      select: { id: true },
    });
    const drafts: LineDraft[] = spec.lines.map((line, sortOrder): LineDraft => {
      if ('equipment' in line) {
        const item = EQUIPMENT.find((entry) => entry.slug === line.equipment);
        const equipmentId = ids.equipmentIds.get(line.equipment);
        if (!item || !equipmentId) throw new Error(`Matériel inconnu : ${line.equipment}`);
        return {
          itemType: 'EQUIPMENT',
          label: item.name,
          quantity: line.quantity,
          unitPrice: unitPrice(item.ttc),
          taxRateBps: TAX_RATE,
          perPerson: false,
          equipmentId,
          sortOrder,
        };
      }
      if ('buffet' in line) {
        const buffet = BUFFETS.find((entry) => entry.slug === line.buffet);
        const buffetId = ids.buffetIds.get(line.buffet);
        if (!buffet || !buffetId) throw new Error(`Buffet inconnu : ${line.buffet}`);
        const perPerson = buffet.pricingUnit === 'PER_PERSON';
        return {
          itemType: 'BUFFET',
          label: buffet.name,
          quantity: line.quantity ?? (perPerson ? spec.guests : 1),
          unitPrice: unitPrice(buffet.ttc),
          taxRateBps: TAX_RATE,
          perPerson,
          buffetId,
          sortOrder,
        };
      }
      const packageId = ids.packageIds.get(line.package);
      if (!packageId) throw new Error(`Menu inconnu : ${line.package}`);
      return {
        itemType: 'PACKAGE',
        label: { fr: 'Formule Mariage Prestige', ar: 'عرض العرس الفاخر' },
        quantity: spec.guests,
        unitPrice: unitPrice(450),
        taxRateBps: TAX_RATE,
        perPerson: true,
        packageId,
        sortOrder,
      };
    });

    const eventDate = zonedToUtc(spec.date, spec.start, traiteur.timezone);
    const eventEndDate = zonedToUtc(
      spec.nextDay ? addDays(spec.date, 1) : spec.date,
      spec.end,
      traiteur.timezone,
    );
    const createdAt = new Date(eventDate.getTime() - 21 * 86_400_000);
    const path: OrderStatus[] =
      spec.status === 'CONFIRMED' ? ['PENDING', 'CONFIRMED'] : ['PENDING'];

    await prisma.$transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, {
        traiteurId,
        type: 'ORDER',
        date: createdAt,
        timeZone: traiteur.timezone,
      });
      const order = await tx.order.create({
        data: {
          traiteurId,
          reference: number.reference,
          clientId: client.id,
          eventType: spec.type,
          eventDate,
          eventEndDate,
          guestCount: spec.guests,
          venueName: spec.venue,
          venueAddress: 'Adresse de démonstration',
          city: spec.city,
          status: spec.status,
          priceMode: traiteur.priceEntryMode,
          internalNotes: `${MARKER}${String(index + 1)}`,
          equipmentSetupHours: spec.setupHours ?? null,
          confirmedAt:
            spec.status === 'CONFIRMED' ? new Date(createdAt.getTime() + 86_400_000) : null,
          createdAt,
        },
      });
      await addDocumentLines(tx, { kind: 'ORDER', id: order.id, traiteurId }, drafts);
      await tx.orderStatusChange.createMany({
        data: path.map((status, step) => ({
          traiteurId,
          orderId: order.id,
          fromStatus: step === 0 ? null : (path[step - 1] ?? null),
          toStatus: status,
          actorUserId: adminUserId,
          actorName,
          createdAt: new Date(createdAt.getTime() + step * 86_400_000),
        })),
      });
    });
  }
  console.log(
    `✓ ${ORDERS.length} commandes avec matériel et buffets (soutenance, mariage, fiançailles en attente)`,
  );
}

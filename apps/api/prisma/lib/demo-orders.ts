/**
 * Clients et commandes de démonstration : une vingtaine de commandes réparties sur deux mois
 * (mi-septembre à mi-novembre 2026), dans tous les statuts, avec un jour complet (capacité 3)
 * et des dates bloquées. Idempotent : rien n'est recréé si les commandes existent déjà.
 */
import {
  addDays,
  type EventType,
  type OrderStatus,
  type PriceMode,
  zonedToUtc,
} from '@traiteur/shared';

import type { LineDraft } from '../../src/documents/document-lines';
import { addDocumentLines } from '../../src/documents/document-lines';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { nextDocumentNumber } from '../../src/sequences/document-sequence';

/** Article du catalogue avec son prix TTC (le traiteur de démo saisit en TTC). */
export interface CatalogRef {
  id: string;
  label: string;
  /** Prix unitaire dans le mode de la commande (centimes). */
  unitPrice: number;
  taxRateBps: number;
  perPerson: boolean;
}

export interface DemoCatalog {
  packages: Map<string, CatalogRef>;
  dishes: Map<string, CatalogRef>;
  services: Map<string, CatalogRef>;
}

const MARKER = 'Démo #';

const DEMO_CLIENTS = [
  {
    key: 'amine',
    phone: '+212661000001',
    firstName: 'Amine',
    lastName: 'Tazi',
    tags: ['fidèle'],
    city: 'Casablanca',
  },
  {
    key: 'houda',
    phone: '+212661000002',
    firstName: 'Houda',
    lastName: 'El Fassi',
    tags: ['mariage'],
    city: 'Rabat',
  },
  {
    key: 'youssef',
    phone: '+212661000003',
    firstName: 'Youssef',
    lastName: 'Berrada',
    tags: ['entreprise'],
    city: 'Casablanca',
    email: 'events@atlas-conseil.ma',
  },
  {
    key: 'khadija',
    phone: '+212661000004',
    firstName: 'Khadija',
    lastName: 'Chraibi',
    tags: [],
    city: 'Mohammedia',
  },
  {
    key: 'omar',
    phone: '+212661000005',
    firstName: 'Omar',
    lastName: 'Lahlou',
    tags: ['fidèle', 'VIP'],
    city: 'Casablanca',
  },
  {
    key: 'sara',
    phone: '+212661000006',
    firstName: 'Sara',
    lastName: 'Bennis',
    tags: ['mariage'],
    city: 'Marrakech',
  },
  {
    key: 'rachid',
    phone: '+212661000007',
    firstName: 'Rachid',
    lastName: 'Ouazzani',
    tags: [],
    city: 'El Jadida',
  },
  {
    key: 'leila',
    phone: '+212661000008',
    firstName: 'Leïla',
    lastName: 'Kettani',
    tags: ['entreprise'],
    city: 'Casablanca',
  },
  // Cliente installée en France, sans SMS : créée par le traiteur
  {
    key: 'ines',
    phone: '+33612345678',
    firstName: 'Inès',
    lastName: 'Sefrioui',
    tags: ['étranger'],
    city: 'Casablanca',
  },
] as const;

type ClientKey = (typeof DEMO_CLIENTS)[number]['key'] | 'salma';

type LineSpec =
  | { package: string }
  | { dish: string; quantity?: number }
  | { service: string; quantity: number }
  | { custom: string; unitPrice: number; quantity: number; discount?: number };

interface OrderSpec {
  client: ClientKey;
  type: EventType;
  date: string;
  start: string;
  end?: string;
  nextDay?: boolean;
  guests: number;
  venue: string;
  city: string;
  status: OrderStatus;
  lines: LineSpec[];
  reason?: string;
  notes?: string;
}

const DH = (amount: number) => Math.round(amount * 100);

const ORDERS: OrderSpec[] = [
  // Passées
  {
    client: 'houda',
    type: 'WEDDING',
    date: '2026-09-13',
    start: '20:00',
    end: '02:00',
    nextDay: true,
    guests: 220,
    venue: 'Palais des Roses',
    city: 'Rabat',
    status: 'COMPLETED',
    lines: [{ package: 'formule-mariage-prestige' }, { service: 'serveur', quantity: 8 }],
  },
  {
    client: 'amine',
    type: 'ENGAGEMENT',
    date: '2026-09-19',
    start: '19:00',
    end: '23:30',
    guests: 120,
    venue: 'Villa Anfa',
    city: 'Casablanca',
    status: 'COMPLETED',
    lines: [{ package: 'formule-fiancailles' }, { dish: 'jus-frais' }],
  },
  {
    client: 'khadija',
    type: 'BIRTHDAY',
    date: '2026-09-20',
    start: '16:00',
    end: '20:00',
    guests: 40,
    venue: 'Domicile',
    city: 'Mohammedia',
    status: 'CANCELLED',
    reason: 'Événement reporté par la cliente',
    lines: [{ dish: 'pastilla-poulet' }, { dish: 'the-menthe' }],
  },
  {
    client: 'omar',
    type: 'AQIQA',
    date: '2026-09-27',
    start: '13:00',
    end: '17:00',
    guests: 80,
    venue: 'Domicile familial',
    city: 'Casablanca',
    status: 'COMPLETED',
    lines: [{ package: 'formule-aqiqa' }],
  },
  {
    client: 'youssef',
    type: 'CORPORATE',
    date: '2026-10-03',
    start: '12:30',
    end: '15:00',
    guests: 60,
    venue: 'Atlas Conseil — 4e étage',
    city: 'Casablanca',
    status: 'DELIVERED',
    lines: [{ dish: 'salades-marocaines' }, { dish: 'poulet-mhammer' }, { dish: 'jus-frais' }],
  },
  {
    client: 'sara',
    type: 'WEDDING',
    date: '2026-10-04',
    start: '20:30',
    end: '03:00',
    nextDay: true,
    guests: 250,
    venue: 'Riad Al Bahja',
    city: 'Marrakech',
    status: 'CONFIRMED',
    lines: [{ package: 'formule-mariage-prestige' }, { service: 'musique', quantity: 1 }],
  },
  {
    client: 'rachid',
    type: 'ENGAGEMENT',
    date: '2026-10-07',
    start: '19:00',
    end: '23:00',
    guests: 90,
    venue: 'Salle Al Mouahidine',
    city: 'El Jadida',
    status: 'DELIVERED',
    lines: [{ package: 'formule-fiancailles' }],
  },
  // Aujourd'hui (8 octobre)
  {
    client: 'leila',
    type: 'CORPORATE',
    date: '2026-10-08',
    start: '12:30',
    end: '14:30',
    guests: 30,
    venue: 'Twin Center',
    city: 'Casablanca',
    status: 'CONFIRMED',
    lines: [
      { dish: 'briouates-viande', quantity: 90 },
      { dish: 'the-menthe' },
      { custom: 'Livraison et installation', unitPrice: DH(500), quantity: 1 },
    ],
  },
  {
    client: 'amine',
    type: 'BIRTHDAY',
    date: '2026-10-08',
    start: '19:30',
    end: '23:00',
    guests: 50,
    venue: 'Villa Anfa',
    city: 'Casablanca',
    status: 'IN_PREPARATION',
    lines: [
      { dish: 'pastilla-poulet' },
      { dish: 'cornes-de-gazelle', quantity: 150 },
      { custom: 'Gâteau d’anniversaire', unitPrice: DH(1200), quantity: 1 },
    ],
  },
  // À venir
  {
    client: 'omar',
    type: 'ENGAGEMENT',
    date: '2026-10-10',
    start: '19:00',
    end: '23:30',
    guests: 150,
    venue: 'Hôtel Le Doge',
    city: 'Casablanca',
    status: 'CONFIRMED',
    lines: [{ package: 'formule-fiancailles' }, { service: 'decoration', quantity: 1 }],
  },
  {
    client: 'houda',
    type: 'WEDDING',
    date: '2026-10-11',
    start: '20:00',
    end: '02:00',
    nextDay: true,
    guests: 300,
    venue: 'Palais Mehdi',
    city: 'Rabat',
    status: 'PENDING',
    lines: [{ package: 'formule-mariage-prestige' }, { service: 'vaisselle', quantity: 300 }],
    notes: 'Souhaite une dégustation avant confirmation.',
  },
  {
    client: 'sara',
    type: 'WEDDING',
    date: '2026-10-17',
    start: '21:00',
    end: '02:30',
    nextDay: true,
    guests: 220,
    venue: 'Domaine Ourika',
    city: 'Marrakech',
    status: 'CONFIRMED',
    lines: [
      { package: 'formule-mariage-prestige' },
      { service: 'serveur', quantity: 6 },
      { custom: 'Remise fidélité', unitPrice: DH(2000), quantity: 1, discount: DH(2000) },
    ],
  },
  // Jour complet : trois commandes fermes pour une capacité de 3
  {
    client: 'youssef',
    type: 'CORPORATE',
    date: '2026-10-24',
    start: '12:00',
    end: '15:00',
    guests: 80,
    venue: 'Atlas Conseil',
    city: 'Casablanca',
    status: 'CONFIRMED',
    lines: [{ dish: 'salades-marocaines' }, { dish: 'tajine-agneau-pruneaux' }],
  },
  {
    client: 'khadija',
    type: 'ENGAGEMENT',
    date: '2026-10-24',
    start: '18:00',
    end: '22:00',
    guests: 100,
    venue: 'Salle Yasmine',
    city: 'Mohammedia',
    status: 'CONFIRMED',
    lines: [{ package: 'formule-fiancailles' }],
  },
  {
    client: 'rachid',
    type: 'WEDDING',
    date: '2026-10-24',
    start: '20:30',
    end: '02:00',
    nextDay: true,
    guests: 180,
    venue: 'Salle Al Mouahidine',
    city: 'El Jadida',
    status: 'CONFIRMED',
    lines: [{ package: 'formule-mariage-prestige' }],
  },
  {
    client: 'ines',
    type: 'BIRTHDAY',
    date: '2026-10-24',
    start: '16:00',
    end: '19:00',
    guests: 25,
    venue: 'Domicile',
    city: 'Casablanca',
    status: 'PENDING',
    lines: [{ dish: 'pastilla-poulet' }, { dish: 'jus-frais' }],
  },
  {
    client: 'leila',
    type: 'CORPORATE',
    date: '2026-10-25',
    start: '09:00',
    end: '11:00',
    guests: 40,
    venue: 'Casa Finance City',
    city: 'Casablanca',
    status: 'DRAFT',
    lines: [{ dish: 'briouates-viande', quantity: 120 }, { dish: 'the-menthe' }],
  },
  {
    client: 'amine',
    type: 'OTHER',
    date: '2026-10-29',
    start: '20:00',
    end: '23:00',
    guests: 60,
    venue: 'Villa Anfa',
    city: 'Casablanca',
    status: 'CANCELLED',
    reason: 'Client injoignable depuis la demande',
    lines: [{ dish: 'mechoui' }],
  },
  {
    client: 'youssef',
    type: 'CORPORATE',
    date: '2026-11-03',
    start: '12:00',
    end: '15:00',
    guests: 120,
    venue: 'Atlas Conseil',
    city: 'Casablanca',
    status: 'PENDING',
    lines: [
      { dish: 'salades-marocaines' },
      { dish: 'poulet-mhammer' },
      { service: 'serveur', quantity: 4 },
    ],
  },
  {
    client: 'omar',
    type: 'WEDDING',
    date: '2026-11-07',
    start: '20:00',
    end: '02:00',
    nextDay: true,
    guests: 350,
    venue: 'Palais Ziryab',
    city: 'Casablanca',
    status: 'CONFIRMED',
    lines: [
      { package: 'formule-mariage-prestige' },
      { service: 'musique', quantity: 1 },
      { service: 'decoration', quantity: 1 },
    ],
  },
  {
    client: 'salma',
    type: 'AQIQA',
    date: '2026-11-14',
    start: '13:00',
    end: '17:00',
    guests: 70,
    venue: 'Domicile',
    city: 'Casablanca',
    status: 'PENDING',
    lines: [{ package: 'formule-aqiqa' }, { dish: 'the-menthe' }],
  },
];

/** Chemin de statuts suivi jusqu'au statut final (pour l'historique). */
function statusPath(status: OrderStatus): OrderStatus[] {
  const firm: OrderStatus[] = [
    'PENDING',
    'CONFIRMED',
    'IN_PREPARATION',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'COMPLETED',
  ];
  if (status === 'DRAFT') return ['DRAFT'];
  if (status === 'CANCELLED') return ['PENDING', 'CANCELLED'];
  return firm.slice(0, firm.indexOf(status) + 1);
}

export const DEMO_BLOCKED_DATES = [
  { date: '2026-10-31', reason: 'Inventaire annuel de la cuisine' },
  { date: '2026-11-06', reason: 'Fête de la Marche verte' },
];

export async function seedDemoClientsAndOrders(
  prisma: PrismaClient,
  traiteur: { id: string; timezone: string; priceEntryMode: PriceMode },
  salmaMembershipId: string,
  adminUserId: string,
  catalog: DemoCatalog,
): Promise<void> {
  const traiteurId = traiteur.id;

  for (const blocked of DEMO_BLOCKED_DATES) {
    const date = new Date(`${blocked.date}T00:00:00Z`);
    await prisma.blockedDate.upsert({
      where: { traiteurId_date: { traiteurId, date } },
      update: {},
      create: { traiteurId, date, reason: blocked.reason },
    });
  }

  const clients = new Map<ClientKey, { id: string; city: string }>([
    ['salma', { id: salmaMembershipId, city: 'Casablanca' }],
  ]);
  for (const demo of DEMO_CLIENTS) {
    // Compte sans mot de passe (connexion par code SMS), comme un client créé au téléphone
    const user = await prisma.user.upsert({
      where: { phone: demo.phone },
      update: {},
      create: { phone: demo.phone, firstName: demo.firstName, lastName: demo.lastName },
    });
    const email = 'email' in demo ? demo.email : null;
    const membership = await prisma.membership.upsert({
      where: { userId_traiteurId: { userId: user.id, traiteurId } },
      update: {},
      create: {
        traiteurId,
        userId: user.id,
        role: 'CLIENT',
        firstName: demo.firstName,
        lastName: demo.lastName,
        email,
        tags: [...demo.tags],
        addresses: {
          create: {
            label: 'Domicile',
            address: 'Adresse de démonstration',
            city: demo.city,
            isDefault: true,
          },
        },
      },
    });
    clients.set(demo.key, { id: membership.id, city: demo.city });
  }

  if (await prisma.order.count({ where: { traiteurId, internalNotes: { startsWith: MARKER } } })) {
    console.log(
      `✓ ${DEMO_CLIENTS.length + 1} clients et ${ORDERS.length} commandes de démonstration déjà présents`,
    );
    return;
  }

  const admin = await prisma.membership.findUniqueOrThrow({
    where: { userId_traiteurId: { userId: adminUserId, traiteurId } },
    select: { firstName: true, lastName: true },
  });
  const actorName = `${admin.firstName} ${admin.lastName}`;

  for (const [index, spec] of ORDERS.entries()) {
    const client = clients.get(spec.client);
    if (!client) throw new Error(`Client de démonstration inconnu : ${spec.client}`);

    const drafts: LineDraft[] = spec.lines.map((line, sortOrder) => {
      if ('custom' in line) {
        return {
          itemType: 'CUSTOM',
          label: line.custom,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount ?? 0,
          taxRateBps: 2000,
          perPerson: false,
          sortOrder,
        };
      }
      const [itemType, ref, quantity] =
        'package' in line
          ? (['PACKAGE', catalog.packages.get(line.package), undefined] as const)
          : 'dish' in line
            ? (['DISH', catalog.dishes.get(line.dish), line.quantity] as const)
            : (['EXTRA_SERVICE', catalog.services.get(line.service), line.quantity] as const);
      if (!ref) throw new Error(`Article de démonstration inconnu : ${JSON.stringify(line)}`);
      return {
        itemType,
        label: ref.label,
        quantity: quantity ?? (ref.perPerson ? spec.guests : 1),
        unitPrice: ref.unitPrice,
        taxRateBps: ref.taxRateBps,
        perPerson: ref.perPerson,
        dishId: itemType === 'DISH' ? ref.id : null,
        packageId: itemType === 'PACKAGE' ? ref.id : null,
        extraServiceId: itemType === 'EXTRA_SERVICE' ? ref.id : null,
        sortOrder,
      };
    });

    const eventDate = zonedToUtc(spec.date, spec.start, traiteur.timezone);
    const eventEndDate = spec.end
      ? zonedToUtc(spec.nextDay ? addDays(spec.date, 1) : spec.date, spec.end, traiteur.timezone)
      : null;
    const path = statusPath(spec.status);
    // Historique daté : demande 3 semaines avant l'événement, puis une étape par jour
    const createdAt = new Date(eventDate.getTime() - 21 * 86_400_000);
    const confirmedIndex = path.indexOf('CONFIRMED');

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
          notes: spec.notes ?? null,
          internalNotes: `${MARKER}${String(index + 1).padStart(2, '0')}`,
          confirmedAt:
            confirmedIndex >= 0
              ? new Date(createdAt.getTime() + confirmedIndex * 86_400_000)
              : null,
          cancelledAt:
            spec.status === 'CANCELLED' ? new Date(createdAt.getTime() + 86_400_000) : null,
          cancellationReason: spec.reason ?? null,
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
          reason: status === 'CANCELLED' ? (spec.reason ?? 'Annulée') : null,
          actorUserId: adminUserId,
          actorName,
          createdAt: new Date(createdAt.getTime() + step * 86_400_000),
        })),
      });
    });
  }
  console.log(
    `✓ ${DEMO_CLIENTS.length + 1} clients, ${ORDERS.length} commandes de démonstration (sept. à nov. 2026), ${DEMO_BLOCKED_DATES.length} dates bloquées`,
  );
}

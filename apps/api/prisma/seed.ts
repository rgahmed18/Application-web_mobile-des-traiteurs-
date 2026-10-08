/**
 * Données de démonstration. Idempotent : peut être relancé sans créer de doublons.
 * Lancement : pnpm db:seed (depuis la racine) ou pnpm --filter @traiteur/api db:seed
 */
import 'dotenv/config';

import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  computeDocumentTotals,
  computeLineAmounts,
  getDefaultFeatureFlags,
  type LineAmounts,
  type LocalizedText,
  PERMISSIONS,
  toStoredPriceHt,
} from '@traiteur/shared';

import {
  type DishUnit,
  type LineItemType,
  type PricingUnit,
  PrismaClient,
} from '../src/generated/prisma/client';
import { nextDocumentNumber } from '../src/sequences/document-sequence';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL est requis');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

export const DEMO_PASSWORD = 'Password123!';
const TAX_RATE = 2000; // 20 %
const DEMO_ORDER_MARKER = 'Commande de démonstration (seed)';

/** Prix saisis TTC par le traiteur (mode TTC), en dirhams. */
const mad = (amount: number) => Math.round(amount * 100);
const priceHt = (ttcMad: number) => toStoredPriceHt(mad(ttcMad), 'TTC', TAX_RATE);

// ─────────────────────── Permissions ───────────────────────

async function seedPermissions(): Promise<void> {
  for (const definition of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: definition.key },
      update: {
        module: definition.module,
        description: definition.description,
        isTenantEditable: definition.isTenantEditable,
      },
      create: {
        key: definition.key,
        module: definition.module,
        description: definition.description,
        isTenantEditable: definition.isTenantEditable,
      },
    });
  }

  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
  const desired = PERMISSIONS.flatMap((definition) =>
    definition.defaultRoles.map((role) => ({
      traiteurId: null,
      role,
      permissionId: idByKey.get(definition.key) ?? '',
      granted: true,
    })),
  );

  // Matrice par défaut (traiteurId = null) : ajout des lignes manquantes…
  await prisma.rolePermission.createMany({ data: desired, skipDuplicates: true });
  // …et retrait des lignes qui ne figurent plus dans le catalogue.
  const desiredKeys = new Set(desired.map((d) => `${d.role}:${d.permissionId}`));
  const existing = await prisma.rolePermission.findMany({
    where: { traiteurId: null },
    select: { id: true, role: true, permissionId: true },
  });
  const obsolete = existing.filter((row) => !desiredKeys.has(`${row.role}:${row.permissionId}`));
  if (obsolete.length > 0) {
    await prisma.rolePermission.deleteMany({ where: { id: { in: obsolete.map((r) => r.id) } } });
  }
  console.log(`✓ ${PERMISSIONS.length} permissions, ${desired.length} droits par défaut`);
}

// ─────────────────────── Traiteur ───────────────────────

async function seedTraiteur() {
  const data = {
    name: 'Dar Diafa Traiteur',
    email: 'contact@dar-diafa.ma',
    phone: '+212522000000',
    city: 'Casablanca',
    plan: 'PRO' as const,
    status: 'ACTIVE' as const,
    maxEventsPerDay: 3,
    isVatRegistered: true,
    defaultTaxRateBps: TAX_RATE,
    priceEntryMode: 'TTC' as const,
    legalName: 'Dar Diafa SARL',
    ice: '001234567000089',
    rcNumber: '123456',
    taxId: '12345678',
    patenteNumber: '34567890',
    cnssNumber: '1234567',
    legalAddress: '12, rue des Orangers, Maârif, 20330 Casablanca',
    bankName: 'Banque de démonstration',
    rib: '000 780 0000000000000000 00',
    invoiceFooter: 'Dar Diafa SARL – capital 100 000 MAD – merci de votre confiance.',
  };
  const traiteur = await prisma.traiteur.upsert({
    where: { slug: 'dar-diafa' },
    update: data,
    create: { slug: 'dar-diafa', ...data },
  });

  await prisma.featureFlag.createMany({
    data: getDefaultFeatureFlags(traiteur.plan).map((flag) => ({
      traiteurId: traiteur.id,
      key: flag.key,
      enabled: flag.enabled,
    })),
    skipDuplicates: true,
  });

  // Exemple de surcharge : ce traiteur autorise ses employés à gérer le catalogue.
  const catalogManage = await prisma.permission.findUniqueOrThrow({
    where: { key: 'catalog.manage' },
  });
  await prisma.rolePermission.upsert({
    where: {
      traiteurId_role_permissionId: {
        traiteurId: traiteur.id,
        role: 'EMPLOYE',
        permissionId: catalogManage.id,
      },
    },
    update: { granted: true },
    create: {
      traiteurId: traiteur.id,
      role: 'EMPLOYE',
      permissionId: catalogManage.id,
      granted: true,
    },
  });

  await prisma.blockedDate.upsert({
    where: { traiteurId_date: { traiteurId: traiteur.id, date: new Date('2026-12-31') } },
    update: {},
    create: { traiteurId: traiteur.id, date: new Date('2026-12-31'), reason: 'Congés annuels' },
  });

  console.log(`✓ Traiteur « ${traiteur.name} » (${traiteur.slug}, offre ${traiteur.plan})`);
  return traiteur;
}

// ─────────────────────── Utilisateurs ───────────────────────

const DEMO_USERS = [
  {
    key: 'superAdmin',
    phone: '+212600000001',
    email: 'superadmin@gestion-traiteurs.ma',
    firstName: 'Super',
    lastName: 'Admin',
    role: null,
  },
  {
    key: 'admin',
    phone: '+212600000002',
    email: 'admin@dar-diafa.ma',
    firstName: 'Karim',
    lastName: 'Benjelloun',
    role: 'ADMIN_TRAITEUR',
  },
  {
    key: 'employee',
    phone: '+212600000003',
    email: 'employe@dar-diafa.ma',
    firstName: 'Fatima',
    lastName: 'Zahra',
    role: 'EMPLOYE',
  },
  {
    key: 'driver',
    phone: '+212600000004',
    email: 'livreur@dar-diafa.ma',
    firstName: 'Youssef',
    lastName: 'Amrani',
    role: 'LIVREUR',
  },
  {
    key: 'client',
    phone: '+212600000005',
    email: 'client@exemple.ma',
    firstName: 'Salma',
    lastName: 'Bennani',
    role: 'CLIENT',
  },
] as const;

type DemoUserKey = (typeof DEMO_USERS)[number]['key'];

async function seedUsers(traiteurId: string) {
  const passwordHash = await hash(DEMO_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const memberships = new Map<DemoUserKey, string>();
  const users = new Map<DemoUserKey, string>();

  for (const demo of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { phone: demo.phone },
      update: { email: demo.email, firstName: demo.firstName, lastName: demo.lastName },
      create: {
        phone: demo.phone,
        email: demo.email,
        firstName: demo.firstName,
        lastName: demo.lastName,
        passwordHash,
        isSuperAdmin: demo.role === null,
      },
    });
    users.set(demo.key, user.id);

    if (demo.role) {
      const membership = await prisma.membership.upsert({
        where: { userId_traiteurId: { userId: user.id, traiteurId } },
        update: { role: demo.role, status: 'ACTIVE' },
        create: { userId: user.id, traiteurId, role: demo.role },
      });
      memberships.set(demo.key, membership.id);
    }
  }

  const clientMembershipId = memberships.get('client');
  if (clientMembershipId) {
    const hasAddress = await prisma.clientAddress.count({
      where: { membershipId: clientMembershipId },
    });
    if (hasAddress === 0) {
      await prisma.clientAddress.create({
        data: {
          traiteurId,
          membershipId: clientMembershipId,
          label: 'Domicile',
          address: '45, boulevard Anfa',
          city: 'Casablanca',
          isDefault: true,
        },
      });
    }
  }

  console.log(`✓ ${DEMO_USERS.length} utilisateurs (mot de passe : ${DEMO_PASSWORD})`);
  return { users, memberships };
}

// ─────────────────────── Catalogue ───────────────────────

interface DishSeed {
  slug: string;
  category: string;
  name: LocalizedText;
  description?: LocalizedText;
  ttc: number;
  unit?: DishUnit;
  minQuantity?: number;
  allergens?: string[];
}

const CATEGORIES: { slug: string; name: LocalizedText }[] = [
  { slug: 'entrees', name: { fr: 'Entrées', ar: 'المقبلات' } },
  { slug: 'plats', name: { fr: 'Plats principaux', ar: 'الأطباق الرئيسية' } },
  { slug: 'patisseries', name: { fr: 'Pâtisseries et desserts', ar: 'الحلويات' } },
  { slug: 'boissons', name: { fr: 'Boissons', ar: 'المشروبات' } },
];

const DISHES: DishSeed[] = [
  {
    slug: 'salades-marocaines',
    category: 'entrees',
    name: { fr: 'Assortiment de salades marocaines', ar: 'سلطات مغربية متنوعة' },
    ttc: 25,
  },
  {
    slug: 'pastilla-poulet',
    category: 'entrees',
    name: { fr: 'Pastilla au poulet et amandes', ar: 'بسطيلة بالدجاج واللوز' },
    ttc: 45,
    allergens: ['gluten', 'fruits à coque', 'œufs'],
  },
  {
    slug: 'pastilla-fruits-de-mer',
    category: 'entrees',
    name: { fr: 'Pastilla aux fruits de mer', ar: 'بسطيلة بالحوت' },
    ttc: 60,
    allergens: ['gluten', 'crustacés', 'poisson'],
  },
  {
    slug: 'mechoui',
    category: 'plats',
    name: { fr: "Méchoui d'agneau", ar: 'مشوي الخروف' },
    ttc: 120,
  },
  {
    slug: 'tajine-agneau-pruneaux',
    category: 'plats',
    name: { fr: "Tajine d'agneau aux pruneaux", ar: 'طاجين اللحم بالبرقوق' },
    ttc: 85,
    allergens: ['sésame', 'fruits à coque'],
  },
  {
    slug: 'poulet-mhammer',
    category: 'plats',
    name: { fr: "Poulet m'hammer aux olives", ar: 'دجاج محمر بالزيتون' },
    ttc: 65,
  },
  {
    slug: 'couscous-sept-legumes',
    category: 'plats',
    name: { fr: 'Couscous aux sept légumes', ar: 'كسكس بسبع خضار' },
    ttc: 55,
    allergens: ['gluten'],
  },
  {
    slug: 'cornes-de-gazelle',
    category: 'patisseries',
    name: { fr: 'Cornes de gazelle', ar: 'كعب الغزال' },
    ttc: 4,
    unit: 'PER_PIECE',
    minQuantity: 50,
    allergens: ['gluten', 'fruits à coque'],
  },
  {
    slug: 'chebakia',
    category: 'patisseries',
    name: { fr: 'Chebakia au miel', ar: 'شباكية بالعسل' },
    ttc: 3,
    unit: 'PER_PIECE',
    minQuantity: 50,
    allergens: ['gluten', 'sésame'],
  },
  {
    slug: 'plateau-fruits',
    category: 'patisseries',
    name: { fr: 'Plateau de fruits de saison', ar: 'طبق فواكه موسمية' },
    ttc: 20,
  },
  {
    slug: 'the-menthe',
    category: 'boissons',
    name: { fr: 'Thé à la menthe', ar: 'أتاي بالنعناع' },
    ttc: 10,
  },
  {
    slug: 'jus-frais',
    category: 'boissons',
    name: { fr: 'Jus de fruits frais', ar: 'عصير فواكه طازجة' },
    ttc: 15,
  },
];

const PACKAGES = [
  {
    slug: 'formule-fiancailles',
    name: { fr: 'Formule Fiançailles', ar: 'عرض الخطوبة' },
    description: {
      fr: 'Salades, pastilla, poulet m’hammer, pâtisseries et thé.',
      ar: 'سلطات، بسطيلة، دجاج محمر، حلويات وأتاي.',
    },
    ttcPerPerson: 250,
    minGuests: 50,
    maxGuests: 300,
    dishes: [
      'salades-marocaines',
      'pastilla-poulet',
      'poulet-mhammer',
      'cornes-de-gazelle',
      'the-menthe',
    ],
  },
  {
    slug: 'formule-mariage-prestige',
    name: { fr: 'Formule Mariage Prestige', ar: 'عرض العرس الفاخر' },
    description: {
      fr: 'Le grand menu traditionnel des mariages marocains.',
      ar: 'القائمة التقليدية الكبرى للأعراس المغربية.',
    },
    ttcPerPerson: 450,
    minGuests: 100,
    maxGuests: 800,
    dishes: [
      'pastilla-fruits-de-mer',
      'mechoui',
      'tajine-agneau-pruneaux',
      'plateau-fruits',
      'cornes-de-gazelle',
      'chebakia',
      'the-menthe',
      'jus-frais',
    ],
  },
] as const;

const EXTRA_SERVICES: { id: string; name: LocalizedText; ttc: number; pricingUnit: PricingUnit }[] =
  [
    {
      id: 'e0000000-0000-4000-8000-000000000001',
      name: { fr: 'Décoration florale de la salle', ar: 'تزيين القاعة بالورود' },
      ttc: 8000,
      pricingUnit: 'FLAT',
    },
    {
      id: 'e0000000-0000-4000-8000-000000000002',
      name: { fr: 'Serveur supplémentaire (par soirée)', ar: 'نادل إضافي (لكل أمسية)' },
      ttc: 400,
      pricingUnit: 'PER_UNIT',
    },
    {
      id: 'e0000000-0000-4000-8000-000000000003',
      name: { fr: 'Troupe de musique andalouse', ar: 'جوق الموسيقى الأندلسية' },
      ttc: 6000,
      pricingUnit: 'FLAT',
    },
  ];

async function seedCatalog(traiteurId: string) {
  const categoryIds = new Map<string, string>();
  for (const [index, category] of CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { traiteurId_slug: { traiteurId, slug: category.slug } },
      update: { name: category.name, sortOrder: index },
      create: { traiteurId, slug: category.slug, name: category.name, sortOrder: index },
    });
    categoryIds.set(category.slug, row.id);
  }

  const dishIds = new Map<string, string>();
  for (const dish of DISHES) {
    const data = {
      categoryId: categoryIds.get(dish.category) ?? null,
      name: dish.name,
      priceHt: priceHt(dish.ttc),
      unit: dish.unit ?? 'PER_PERSON',
      minQuantity: dish.minQuantity ?? 1,
      allergens: dish.allergens ?? [],
    };
    const row = await prisma.dish.upsert({
      where: { traiteurId_slug: { traiteurId, slug: dish.slug } },
      update: data,
      create: { traiteurId, slug: dish.slug, ...data },
    });
    dishIds.set(dish.slug, row.id);
  }

  const packageIds = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const data = {
      name: pkg.name,
      description: pkg.description,
      pricePerPersonHt: priceHt(pkg.ttcPerPerson),
      minGuests: pkg.minGuests,
      maxGuests: pkg.maxGuests,
    };
    const row = await prisma.package.upsert({
      where: { traiteurId_slug: { traiteurId, slug: pkg.slug } },
      update: data,
      create: { traiteurId, slug: pkg.slug, ...data },
    });
    packageIds.set(pkg.slug, row.id);

    for (const [index, dishSlug] of pkg.dishes.entries()) {
      const dishId = dishIds.get(dishSlug);
      if (!dishId) throw new Error(`Plat inconnu dans la formule : ${dishSlug}`);
      await prisma.packageDish.upsert({
        where: { packageId_dishId: { packageId: row.id, dishId } },
        update: { sortOrder: index },
        create: { traiteurId, packageId: row.id, dishId, sortOrder: index },
      });
    }
  }

  for (const extra of EXTRA_SERVICES) {
    const data = { name: extra.name, priceHt: priceHt(extra.ttc), pricingUnit: extra.pricingUnit };
    await prisma.extraService.upsert({
      where: { id: extra.id },
      update: data,
      create: { id: extra.id, traiteurId, ...data },
    });
  }

  console.log(
    `✓ Catalogue : ${CATEGORIES.length} catégories, ${DISHES.length} plats, ${PACKAGES.length} formules, ${EXTRA_SERVICES.length} services`,
  );
  return { dishIds, packageIds };
}

// ─────────────────── Commande, devis, facture de démo ───────────────────

interface DemoLine extends LineAmounts {
  itemType: LineItemType;
  label: string;
  packageId?: string;
  extraServiceId?: string;
}

async function seedDemoOrder(
  traiteur: Awaited<ReturnType<typeof seedTraiteur>>,
  memberships: Map<DemoUserKey, string>,
  packageIds: Map<string, string>,
): Promise<void> {
  const clientId = memberships.get('client');
  const adminId = memberships.get('admin');
  const employeeId = memberships.get('employee');
  const driverId = memberships.get('driver');
  const packageId = packageIds.get('formule-fiancailles');
  if (!clientId || !adminId || !employeeId || !driverId || !packageId) {
    throw new Error('Données de démonstration incomplètes');
  }

  const existing = await prisma.order.findFirst({
    where: { traiteurId: traiteur.id, internalNotes: DEMO_ORDER_MARKER },
  });
  if (existing) {
    console.log(`✓ Commande de démonstration déjà présente (${existing.reference})`);
    return;
  }

  const guests = 120;
  const [decoration, waiter] = EXTRA_SERVICES;
  if (!decoration || !waiter) throw new Error('Services de démonstration manquants');
  const lines: DemoLine[] = [
    {
      itemType: 'PACKAGE',
      label: 'Formule Fiançailles',
      packageId,
      ...computeLineAmounts({ unitPriceHt: priceHt(250), quantity: guests, taxRateBps: TAX_RATE }),
    },
    {
      itemType: 'EXTRA_SERVICE',
      label: 'Serveur supplémentaire (par soirée)',
      extraServiceId: waiter.id,
      ...computeLineAmounts({ unitPriceHt: priceHt(400), quantity: 4, taxRateBps: TAX_RATE }),
    },
    {
      itemType: 'EXTRA_SERVICE',
      label: 'Décoration florale de la salle',
      extraServiceId: decoration.id,
      ...computeLineAmounts({
        unitPriceHt: priceHt(8000),
        quantity: 1,
        discountHt: priceHt(1000), // geste commercial de 1 000 MAD TTC
        taxRateBps: TAX_RATE,
      }),
    },
  ];
  const totals = computeDocumentTotals(lines);
  const toRow = (line: DemoLine, index: number) => ({
    itemType: line.itemType,
    label: line.label,
    quantity: line.quantity,
    unitPriceHt: line.unitPriceHt,
    discountHt: line.discountHt,
    taxRateBps: line.taxRateBps,
    totalHt: line.totalHt,
    taxAmount: line.taxAmount,
    totalTtc: line.totalTtc,
    sortOrder: index,
  });

  const eventDate = new Date('2026-11-21T19:00:00+01:00');
  const depositAmount = Math.round(totals.totalTtc * 0.3);

  const order = await prisma.$transaction(async (tx) => {
    const orderNumber = await nextDocumentNumber(tx, { traiteurId: traiteur.id, type: 'ORDER' });
    const created = await tx.order.create({
      data: {
        traiteurId: traiteur.id,
        reference: orderNumber.reference,
        clientId,
        eventType: 'ENGAGEMENT',
        eventDate,
        guestCount: guests,
        venueName: 'Salle Les Jasmins',
        venueAddress: '8, avenue Hassan II',
        city: 'Casablanca',
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        notes: 'Prévoir une table d’honneur pour 10 personnes.',
        internalNotes: DEMO_ORDER_MARKER,
        totalHt: totals.totalHt,
        totalTax: totals.totalTax,
        totalTtc: totals.totalTtc,
        depositAmount,
        items: {
          create: lines.map((line, index) => ({
            ...toRow(line, index),
            packageId: line.packageId ?? null,
            extraServiceId: line.extraServiceId ?? null,
          })),
        },
      },
    });

    const quoteNumber = await nextDocumentNumber(tx, { traiteurId: traiteur.id, type: 'QUOTE' });
    await tx.quote.create({
      data: {
        traiteurId: traiteur.id,
        orderId: created.id,
        reference: quoteNumber.reference,
        status: 'ACCEPTED',
        totalHt: totals.totalHt,
        totalTax: totals.totalTax,
        totalTtc: totals.totalTtc,
        validUntil: new Date('2026-11-01T00:00:00+01:00'),
        sentAt: new Date(),
        acceptedAt: new Date(),
        lines: {
          create: lines.map((line, index) => ({
            ...toRow(line, index),
            packageId: line.packageId ?? null,
            extraServiceId: line.extraServiceId ?? null,
          })),
        },
      },
    });

    const invoiceNumber = await nextDocumentNumber(tx, {
      traiteurId: traiteur.id,
      type: 'INVOICE',
    });
    await tx.invoice.create({
      data: {
        traiteurId: traiteur.id,
        orderId: created.id,
        type: 'INVOICE',
        number: invoiceNumber.reference,
        year: invoiceNumber.year,
        sequenceNumber: invoiceNumber.value,
        totalHt: totals.totalHt,
        totalTax: totals.totalTax,
        totalTtc: totals.totalTtc,
        dueDate: eventDate,
        sellerSnapshot: {
          legalName: traiteur.legalName,
          ice: traiteur.ice,
          rcNumber: traiteur.rcNumber,
          taxId: traiteur.taxId,
          patenteNumber: traiteur.patenteNumber,
          cnssNumber: traiteur.cnssNumber,
          address: traiteur.legalAddress,
          bankName: traiteur.bankName,
          rib: traiteur.rib,
          isVatRegistered: traiteur.isVatRegistered,
        },
        buyerSnapshot: {
          name: 'Salma Bennani',
          phone: '+212600000005',
          address: '45, boulevard Anfa, Casablanca',
        },
        lines: { create: lines.map(toRow) },
      },
    });

    await tx.payment.create({
      data: {
        traiteurId: traiteur.id,
        orderId: created.id,
        amount: depositAmount,
        type: 'DEPOSIT',
        method: 'BANK_TRANSFER',
        status: 'SUCCEEDED',
        paidAt: new Date(),
        recordedById: adminId,
      },
    });

    await tx.staffAssignment.createMany({
      data: [
        {
          traiteurId: traiteur.id,
          orderId: created.id,
          membershipId: employeeId,
          staffRole: 'SUPERVISOR',
          startAt: new Date('2026-11-21T15:00:00+01:00'),
        },
        {
          traiteurId: traiteur.id,
          orderId: created.id,
          membershipId: driverId,
          staffRole: 'DRIVER',
          startAt: new Date('2026-11-21T16:00:00+01:00'),
        },
      ],
    });

    return created;
  });

  console.log(
    `✓ Commande ${order.reference} (${guests} invités, ${(totals.totalTtc / 100).toFixed(2)} MAD TTC) avec devis, facture, acompte et équipe`,
  );
}

async function main(): Promise<void> {
  await seedPermissions();
  const traiteur = await seedTraiteur();
  const { memberships } = await seedUsers(traiteur.id);
  const { packageIds } = await seedCatalog(traiteur.id);
  await seedDemoOrder(traiteur, memberships, packageIds);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

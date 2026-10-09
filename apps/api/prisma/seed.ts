/**
 * Données de démonstration. Idempotent : peut être relancé sans créer de doublons.
 * Lancement : pnpm db:seed (depuis la racine) ou pnpm --filter @traiteur/api db:seed
 */
import 'dotenv/config';

import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  type Allergen,
  type CatalogPrices,
  computeCatalogPrices,
  computeDocumentTotals,
  getDefaultFeatureFlags,
  type LocalizedText,
  type PriceMode,
  unitPriceFor,
} from '@traiteur/shared';

import { type DishUnit, type PricingUnit, PrismaClient } from '../src/generated/prisma/client';
import {
  addDocumentLines,
  computeDraftAmounts,
  type LineDraft,
} from '../src/documents/document-lines';
import { syncPermissionCatalog } from '../src/access/permission-catalog';
import { type CatalogRef, type DemoCatalog, seedDemoClientsAndOrders } from './lib/demo-orders';
import { generateIllustration, PALETTES } from './lib/illustrations';
import { connectScriptStorage, storeAndAttachImage } from './lib/media-script';
import { nextDocumentNumber } from '../src/sequences/document-sequence';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL est requis');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

export const DEMO_PASSWORD = 'Password123!';
const TAX_RATE = 2000; // 20 %
const DEMO_ORDER_MARKER = 'Commande de démonstration (seed)';

/** Montant en dirhams → centimes. */
const mad = (amount: number) => Math.round(amount * 100);
/** Le traiteur de démo saisit ses prix TTC : le TTC est conservé, le HT est dérivé. */
const catalogPrices = (ttcMad: number, taxRateBps = TAX_RATE): CatalogPrices =>
  computeCatalogPrices(mad(ttcMad), 'TTC', taxRateBps);

// ─────────────────────── Permissions ───────────────────────

async function seedPermissions(): Promise<void> {
  const { permissions, defaultGrants } = await syncPermissionCatalog(prisma);
  console.log(`✓ ${permissions} permissions, ${defaultGrants} droits par défaut`);
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
    where: { key: 'catalog.write' },
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
        create: {
          userId: user.id,
          traiteurId,
          role: demo.role,
          firstName: demo.firstName,
          lastName: demo.lastName,
          email: demo.email,
        },
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
  description: LocalizedText;
  ttc: number;
  /** Taux propre au plat (sinon taux par défaut du traiteur). */
  taxRateBps?: number;
  unit?: DishUnit;
  minQuantity?: number;
  allergens?: Allergen[];
}

const CATEGORIES: { slug: string; name: LocalizedText }[] = [
  { slug: 'entrees', name: { fr: 'Entrées', ar: 'المقبلات' } },
  { slug: 'soupes', name: { fr: 'Soupes', ar: 'الحساء' } },
  { slug: 'plats', name: { fr: 'Plats principaux', ar: 'الأطباق الرئيسية' } },
  { slug: 'poissons', name: { fr: 'Poissons', ar: 'الأسماك' } },
  { slug: 'patisseries', name: { fr: 'Pâtisseries et desserts', ar: 'الحلويات' } },
  { slug: 'boissons', name: { fr: 'Boissons', ar: 'المشروبات' } },
];

/** Palette d'illustration de chaque catégorie (voir prisma/lib/illustrations.ts). */
const CATEGORY_PALETTE: Record<string, string> = {
  entrees: 'entrees',
  soupes: 'plats',
  plats: 'plats',
  poissons: 'boissons',
  patisseries: 'patisseries',
  boissons: 'boissons',
};

const DISHES: DishSeed[] = [
  // Entrées
  {
    slug: 'salades-marocaines',
    category: 'entrees',
    name: { fr: 'Assortiment de salades marocaines', ar: 'سلطات مغربية متنوعة' },
    description: {
      fr: 'Zaalouk, taktouka, carottes au cumin et betteraves, servis en petits plats.',
      ar: 'زعلوك، تكتوكة، جزر بالكمون وشمندر، تقدم في صحون صغيرة.',
    },
    ttc: 25,
  },
  {
    slug: 'briouates-viande',
    category: 'entrees',
    name: { fr: 'Briouates à la viande hachée', ar: 'بريوات باللحم المفروم' },
    description: {
      fr: 'Feuilles de brick croustillantes farcies de viande hachée épicée.',
      ar: 'أوراق البسطيلة المقرمشة محشوة باللحم المفروم المتبل.',
    },
    ttc: 3,
    unit: 'PER_PIECE',
    minQuantity: 50,
    allergens: ['gluten', 'eggs'],
  },
  {
    slug: 'pastilla-poulet',
    category: 'entrees',
    name: { fr: 'Pastilla au poulet et amandes', ar: 'بسطيلة بالدجاج واللوز' },
    description: {
      fr: 'Feuilletée sucrée-salée, poulet confit, amandes grillées, cannelle et sucre glace.',
      ar: 'بسطيلة حلوة ومالحة بالدجاج واللوز المحمص والقرفة والسكر.',
    },
    ttc: 45,
    allergens: ['gluten', 'nuts', 'eggs'],
  },
  {
    slug: 'pastilla-fruits-de-mer',
    category: 'entrees',
    name: { fr: 'Pastilla aux fruits de mer', ar: 'بسطيلة بالحوت' },
    description: {
      fr: 'Crevettes, calamars et poisson blanc, vermicelles et chermoula.',
      ar: 'قمرون وكلمار وسمك أبيض مع الشعرية والشرمولة.',
    },
    ttc: 60,
    allergens: ['gluten', 'crustaceans', 'molluscs', 'fish', 'eggs'],
  },
  // Soupes
  {
    slug: 'harira',
    category: 'soupes',
    name: { fr: 'Harira traditionnelle', ar: 'حريرة تقليدية' },
    description: {
      fr: 'Soupe de tomates, lentilles et pois chiches, servie avec dattes et chebakia.',
      ar: 'حساء الطماطم والعدس والحمص، يقدم مع التمر والشباكية.',
    },
    ttc: 15,
    allergens: ['gluten', 'celery'],
  },
  // Plats
  {
    slug: 'mechoui',
    category: 'plats',
    name: { fr: "Méchoui d'agneau", ar: 'مشوي الخروف' },
    description: {
      fr: 'Épaule d’agneau rôtie lentement, servie avec cumin et sel.',
      ar: 'كتف خروف مشوي على نار هادئة، يقدم مع الكمون والملح.',
    },
    ttc: 120,
  },
  {
    slug: 'tajine-agneau-pruneaux',
    category: 'plats',
    name: { fr: "Tajine d'agneau aux pruneaux", ar: 'طاجين اللحم بالبرقوق' },
    description: {
      fr: 'Agneau fondant, pruneaux caramélisés, amandes et graines de sésame.',
      ar: 'لحم غنمي طري مع البرقوق المعسل واللوز والجلجلان.',
    },
    ttc: 85,
    allergens: ['sesame', 'nuts'],
  },
  {
    slug: 'tajine-poulet-citron',
    category: 'plats',
    name: { fr: 'Tajine de poulet au citron confit', ar: 'طاجين الدجاج بالحامض المرقد' },
    description: {
      fr: 'Poulet fermier, citron confit, olives violettes et gingembre.',
      ar: 'دجاج بلدي بالحامض المرقد والزيتون والزنجبيل.',
    },
    ttc: 60,
  },
  {
    slug: 'poulet-mhammer',
    category: 'plats',
    name: { fr: "Poulet m'hammer aux olives", ar: 'دجاج محمر بالزيتون' },
    description: {
      fr: 'Poulet mijoté puis doré au four, sauce au safran et olives.',
      ar: 'دجاج مطهو ثم محمر في الفرن، بمرق الزعفران والزيتون.',
    },
    ttc: 65,
  },
  {
    slug: 'couscous-sept-legumes',
    category: 'plats',
    name: { fr: 'Couscous aux sept légumes', ar: 'كسكس بسبع خضار' },
    description: {
      fr: 'Semoule roulée à la main, sept légumes de saison et bouillon parfumé.',
      ar: 'كسكس مفتول يدويًا بسبع خضار موسمية ومرق معطر.',
    },
    ttc: 55,
    allergens: ['gluten', 'celery'],
  },
  {
    slug: 'rfissa',
    category: 'plats',
    name: { fr: 'Rfissa au poulet', ar: 'رفيسة بالدجاج' },
    description: {
      fr: 'Msemmen effiloché, poulet, lentilles et fenugrec : le plat des naissances.',
      ar: 'مسمن مقطع بالدجاج والعدس والحلبة، طبق المناسبات العائلية.',
    },
    ttc: 70,
    allergens: ['gluten'],
  },
  {
    slug: 'tangia',
    category: 'plats',
    name: { fr: 'Tangia marrakchie', ar: 'طنجية مراكشية' },
    description: {
      fr: 'Jarret de bœuf cuit lentement au cumin, citron confit et smen.',
      ar: 'لحم بقري مطهو ببطء بالكمون والحامض المرقد والسمن.',
    },
    ttc: 95,
    allergens: ['milk'],
  },
  {
    slug: 'mrouzia',
    category: 'plats',
    name: { fr: 'Mrouzia aux raisins secs', ar: 'مروزية بالزبيب' },
    description: {
      fr: 'Agneau au ras-el-hanout, miel, raisins secs et amandes : plat de fête.',
      ar: 'لحم غنمي برأس الحانوت والعسل والزبيب واللوز، طبق الأعياد.',
    },
    ttc: 110,
    allergens: ['nuts'],
  },
  // Poissons
  {
    slug: 'poisson-chermoula',
    category: 'poissons',
    name: { fr: 'Poisson à la chermoula', ar: 'سمك بالشرمولة' },
    description: {
      fr: 'Loup ou dorade au four, chermoula, pommes de terre et poivrons.',
      ar: 'قاروص أو دوراد في الفرن بالشرمولة والبطاطس والفلفل.',
    },
    ttc: 90,
    allergens: ['fish'],
  },
  // Pâtisseries et desserts
  {
    slug: 'cornes-de-gazelle',
    category: 'patisseries',
    name: { fr: 'Cornes de gazelle', ar: 'كعب الغزال' },
    description: {
      fr: 'Pâte fine farcie de pâte d’amande parfumée à la fleur d’oranger.',
      ar: 'عجين رقيق محشو بعجينة اللوز المعطرة بماء الزهر.',
    },
    ttc: 4,
    unit: 'PER_PIECE',
    minQuantity: 50,
    allergens: ['gluten', 'nuts'],
  },
  {
    slug: 'chebakia',
    category: 'patisseries',
    name: { fr: 'Chebakia au miel', ar: 'شباكية بالعسل' },
    description: {
      fr: 'Fleurs de pâte frites, enrobées de miel et de sésame.',
      ar: 'عجين مقلي على شكل وردة، مغطى بالعسل والجلجلان.',
    },
    ttc: 3,
    unit: 'PER_PIECE',
    minQuantity: 50,
    allergens: ['gluten', 'sesame'],
  },
  {
    slug: 'ghriba-amandes',
    category: 'patisseries',
    name: { fr: 'Ghriba aux amandes', ar: 'غريبة باللوز' },
    description: {
      fr: 'Biscuits craquelés aux amandes, moelleux à cœur.',
      ar: 'حلوى اللوز المشققة، طرية من الداخل.',
    },
    ttc: 3,
    unit: 'PER_PIECE',
    minQuantity: 50,
    allergens: ['nuts', 'eggs'],
  },
  {
    slug: 'sellou',
    category: 'patisseries',
    name: { fr: 'Sellou (sfouf)', ar: 'سلو (السفوف)' },
    description: {
      fr: 'Farine grillée, amandes, sésame, anis et miel, servi au kilo.',
      ar: 'دقيق محمص ولوز وجلجلان ونافع وعسل، يباع بالكيلو.',
    },
    ttc: 180,
    unit: 'PER_KG',
    allergens: ['gluten', 'nuts', 'sesame'],
  },
  {
    slug: 'plateau-fruits',
    category: 'patisseries',
    name: { fr: 'Plateau de fruits de saison', ar: 'طبق فواكه موسمية' },
    description: {
      fr: 'Fruits frais découpés, présentés sur plateau.',
      ar: 'فواكه طازجة مقطعة، تقدم في طبق.',
    },
    ttc: 20,
  },
  // Boissons
  {
    slug: 'the-menthe',
    category: 'boissons',
    name: { fr: 'Thé à la menthe', ar: 'أتاي بالنعناع' },
    description: {
      fr: 'Thé vert à la menthe fraîche, servi à la théière.',
      ar: 'شاي أخضر بالنعناع الطري، يقدم في البراد.',
    },
    ttc: 10,
  },
  {
    slug: 'jus-frais',
    category: 'boissons',
    name: { fr: 'Jus de fruits frais', ar: 'عصير فواكه طازجة' },
    description: {
      fr: 'Orange, avocat ou panaché selon la saison.',
      ar: 'برتقال أو أفوكا أو مشكل حسب الموسم.',
    },
    ttc: 15,
    taxRateBps: 1000, // exemple de taux réduit : 10 %
    allergens: ['milk'],
  },
];

const PACKAGES = [
  {
    slug: 'formule-fiancailles',
    name: { fr: 'Formule Fiançailles', ar: 'عرض الخطوبة' },
    description: {
      fr: 'Salades, pastilla au poulet, poulet m’hammer, cornes de gazelle et thé.',
      ar: 'سلطات، بسطيلة بالدجاج، دجاج محمر، كعب الغزال وأتاي.',
    },
    ttcPerPerson: 250,
    minGuests: 50,
    maxGuests: 300,
    dishes: [
      ['salades-marocaines', 1],
      ['pastilla-poulet', 1],
      ['poulet-mhammer', 1],
      ['cornes-de-gazelle', 3],
      ['the-menthe', 1],
    ],
  },
  {
    slug: 'formule-mariage-prestige',
    name: { fr: 'Formule Mariage Prestige', ar: 'عرض العرس الفاخر' },
    description: {
      fr: 'Le grand menu traditionnel des mariages marocains, du méchoui aux pâtisseries.',
      ar: 'القائمة التقليدية الكبرى للأعراس المغربية، من المشوي إلى الحلويات.',
    },
    ttcPerPerson: 450,
    minGuests: 100,
    maxGuests: 800,
    dishes: [
      ['pastilla-fruits-de-mer', 1],
      ['mechoui', 1],
      ['tajine-agneau-pruneaux', 1],
      ['plateau-fruits', 1],
      ['cornes-de-gazelle', 2],
      ['chebakia', 2],
      ['the-menthe', 1],
      ['jus-frais', 1],
    ],
  },
  {
    slug: 'formule-aqiqa',
    name: { fr: 'Formule Aqiqa', ar: 'عرض العقيقة' },
    description: {
      fr: 'Harira, rfissa au poulet, ghriba et thé pour célébrer une naissance.',
      ar: 'حريرة، رفيسة بالدجاج، غريبة وأتاي للاحتفال بالمولود.',
    },
    ttcPerPerson: 180,
    minGuests: 30,
    maxGuests: 200,
    dishes: [
      ['harira', 1],
      ['rfissa', 1],
      ['ghriba-amandes', 2],
      ['the-menthe', 1],
    ],
  },
] as const;

interface ServiceSeed {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  ttc: number;
  pricingUnit: PricingUnit;
}

const EXTRA_SERVICES: ServiceSeed[] = [
  {
    id: 'e0000000-0000-4000-8000-000000000001',
    name: { fr: 'Décoration florale de la salle', ar: 'تزيين القاعة بالورود' },
    description: { fr: 'Centres de table et arche fleurie.', ar: 'زينة الطاولات وقوس من الورود.' },
    ttc: 8000,
    pricingUnit: 'FLAT',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000002',
    name: { fr: 'Serveur supplémentaire (par soirée)', ar: 'نادل إضافي (لكل أمسية)' },
    description: { fr: 'Service en tenue traditionnelle.', ar: 'خدمة بلباس تقليدي.' },
    ttc: 400,
    pricingUnit: 'PER_UNIT',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000003',
    name: { fr: 'Troupe de musique andalouse', ar: 'جوق الموسيقى الأندلسية' },
    description: { fr: 'Orchestre de 6 musiciens, 4 heures.', ar: 'جوق من 6 عازفين لمدة 4 ساعات.' },
    ttc: 6000,
    pricingUnit: 'FLAT',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000004',
    name: { fr: 'Location de vaisselle traditionnelle', ar: 'كراء الأواني التقليدية' },
    description: {
      fr: 'Théières, plateaux et tajines décoratifs, par invité.',
      ar: 'براريد وصواني وطواجن للزينة، لكل ضيف.',
    },
    ttc: 15,
    pricingUnit: 'PER_PERSON',
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
      description: dish.description,
      ...catalogPrices(dish.ttc, dish.taxRateBps),
      taxRateBps: dish.taxRateBps ?? null,
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
      pricePerPersonHt: catalogPrices(pkg.ttcPerPerson).priceHt,
      pricePerPersonTtc: catalogPrices(pkg.ttcPerPerson).priceTtc,
      minGuests: pkg.minGuests,
      maxGuests: pkg.maxGuests,
    };
    const row = await prisma.package.upsert({
      where: { traiteurId_slug: { traiteurId, slug: pkg.slug } },
      update: data,
      create: { traiteurId, slug: pkg.slug, ...data },
    });
    packageIds.set(pkg.slug, row.id);

    for (const [index, [dishSlug, quantity]] of pkg.dishes.entries()) {
      const dishId = dishIds.get(dishSlug);
      if (!dishId) throw new Error(`Plat inconnu dans la formule : ${dishSlug}`);
      await prisma.packageDish.upsert({
        where: { packageId_dishId: { packageId: row.id, dishId } },
        update: { sortOrder: index, quantity },
        create: { traiteurId, packageId: row.id, dishId, sortOrder: index, quantity },
      });
    }
  }

  for (const extra of EXTRA_SERVICES) {
    const data = {
      name: extra.name,
      description: extra.description,
      ...catalogPrices(extra.ttc),
      pricingUnit: extra.pricingUnit,
    };
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

/**
 * Illustrations de démonstration (générées, sans droits) pour chaque plat et formule sans photo.
 * Remplaçables par de vraies photos : pnpm --filter @traiteur/api catalog:set-photo.
 */
async function seedIllustrations(
  traiteurId: string,
  dishIds: Map<string, string>,
  packageIds: Map<string, string>,
): Promise<void> {
  const storage = await connectScriptStorage();
  if (!storage) {
    console.warn('⚠ Variables S3_* absentes : catalogue créé sans photos.');
    return;
  }

  let created = 0;
  try {
    for (const dish of DISHES) {
      const id = dishIds.get(dish.slug);
      if (!id) continue;
      const row = await prisma.dish.findUniqueOrThrow({
        where: { id },
        select: { imageKey: true },
      });
      if (row.imageKey) continue;
      const palette = PALETTES[CATEGORY_PALETTE[dish.category] ?? 'plats'] ?? PALETTES.plats;
      if (!palette) continue;
      const image = await generateIllustration(dish.slug, palette);
      const imageKey = await storeAndAttachImage(prisma, storage, traiteurId, 'Dish', id, image);
      await prisma.dish.update({ where: { id }, data: { imageKey } });
      created += 1;
    }
    for (const pkg of PACKAGES) {
      const id = packageIds.get(pkg.slug);
      const palette = PALETTES.formules;
      if (!id || !palette) continue;
      const row = await prisma.package.findUniqueOrThrow({
        where: { id },
        select: { imageKey: true },
      });
      if (row.imageKey) continue;
      const image = await generateIllustration(pkg.slug, palette);
      const imageKey = await storeAndAttachImage(prisma, storage, traiteurId, 'Package', id, image);
      await prisma.package.update({ where: { id }, data: { imageKey } });
      created += 1;
    }
  } catch (error) {
    console.warn(`⚠ Stockage des photos injoignable (docker compose up ?) : ${String(error)}`);
    return;
  }
  console.log(
    created > 0
      ? `✓ ${created} illustration(s) de démonstration générée(s)`
      : '✓ Illustrations déjà présentes',
  );
}

// ─────────────────── Commande, devis, facture de démo ───────────────────

async function seedDemoOrder(
  traiteur: Awaited<ReturnType<typeof seedTraiteur>>,
  memberships: Map<DemoUserKey, string>,
  dishIds: Map<string, string>,
  packageIds: Map<string, string>,
): Promise<void> {
  const clientId = memberships.get('client');
  const adminId = memberships.get('admin');
  const employeeId = memberships.get('employee');
  const driverId = memberships.get('driver');
  const packageId = packageIds.get('formule-fiancailles');
  const juiceId = dishIds.get('jus-frais');
  if (!clientId || !adminId || !employeeId || !driverId || !packageId || !juiceId) {
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

  // Le mode de prix du traiteur est figé sur chaque document créé.
  const priceMode: PriceMode = traiteur.priceEntryMode;
  // Saisies dans le mode du document : le prix qui fait foi au catalogue (TTC ici).
  const price = (prices: CatalogPrices) => unitPriceFor(prices, priceMode);
  const drafts: LineDraft[] = [
    {
      itemType: 'PACKAGE',
      label: 'Formule Fiançailles',
      packageId,
      quantity: guests,
      unitPrice: price(catalogPrices(250)), // 250 MAD × 120 = 30 000,00 MAD TTC
      taxRateBps: TAX_RATE,
      perPerson: true,
    },
    {
      itemType: 'DISH',
      label: 'Jus de fruits frais',
      dishId: juiceId,
      quantity: guests,
      unitPrice: price(catalogPrices(15, 1000)),
      taxRateBps: 1000,
      perPerson: true,
    },
    {
      itemType: 'EXTRA_SERVICE',
      label: 'Serveur supplémentaire (par soirée)',
      extraServiceId: waiter.id,
      quantity: 4,
      unitPrice: price(catalogPrices(400)),
      taxRateBps: TAX_RATE,
    },
    {
      itemType: 'EXTRA_SERVICE',
      label: 'Décoration florale de la salle',
      extraServiceId: decoration.id,
      quantity: 1,
      unitPrice: price(catalogPrices(8000)),
      discount: price(catalogPrices(1000)), // geste commercial de 1 000 MAD TTC
      taxRateBps: TAX_RATE,
    },
  ];
  // Mêmes calculs que DocumentLinesService : utilisés pour l'acompte et la facture (snapshot).
  const lines = drafts.map((draft) => ({
    draft,
    amounts: computeDraftAmounts(priceMode, draft),
  }));
  const totals = computeDocumentTotals(lines.map(({ amounts }) => amounts));
  const toInvoiceRow = ({ draft, amounts }: (typeof lines)[number], index: number) => ({
    itemType: draft.itemType,
    label: draft.label,
    quantity: amounts.quantity,
    unitPriceHt: amounts.unitPriceHt,
    unitPriceTtc: amounts.unitPriceTtc,
    discountHt: amounts.discountHt,
    discountTtc: amounts.discountTtc,
    taxRateBps: amounts.taxRateBps,
    totalHt: amounts.totalHt,
    taxAmount: amounts.taxAmount,
    totalTtc: amounts.totalTtc,
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
        priceMode,
        confirmedAt: new Date(),
        notes: 'Prévoir une table d’honneur pour 10 personnes.',
        internalNotes: DEMO_ORDER_MARKER,
        depositAmount,
      },
    });
    await addDocumentLines(tx, { kind: 'ORDER', id: created.id, traiteurId: traiteur.id }, drafts);

    const quoteNumber = await nextDocumentNumber(tx, { traiteurId: traiteur.id, type: 'QUOTE' });
    const quote = await tx.quote.create({
      data: {
        traiteurId: traiteur.id,
        orderId: created.id,
        reference: quoteNumber.reference,
        status: 'ACCEPTED',
        priceMode,
        validUntil: new Date('2026-11-01T00:00:00+01:00'),
        sentAt: new Date(),
        acceptedAt: new Date(),
      },
    });
    await addDocumentLines(tx, { kind: 'QUOTE', id: quote.id, traiteurId: traiteur.id }, drafts);

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
        priceMode,
        totalHt: totals.totalHt,
        totalTax: totals.totalTax,
        totalTtc: totals.totalTtc,
        taxBreakdown: totals.taxBreakdown.map((entry) => ({ ...entry })),
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
        lines: { create: lines.map(toInvoiceRow) },
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
    `✓ Commande ${order.reference} en mode ${priceMode} : ${guests} invités, ${(totals.totalHt / 100).toFixed(2)} HT + ${(totals.totalTax / 100).toFixed(2)} TVA = ${(totals.totalTtc / 100).toFixed(2)} MAD TTC (devis, facture, acompte, équipe)`,
  );
}

// ─────────────────── Clients et commandes de démonstration ───────────────────

/** Prix et identifiants du catalogue, dans le mode de prix des commandes du traiteur. */
function demoCatalog(
  priceMode: PriceMode,
  dishIds: Map<string, string>,
  packageIds: Map<string, string>,
): DemoCatalog {
  const ref = (
    id: string | undefined,
    label: string,
    ttc: number,
    taxRateBps: number,
    perPerson: boolean,
  ): CatalogRef => {
    if (!id) throw new Error(`Article inconnu : ${label}`);
    return {
      id,
      label,
      unitPrice: unitPriceFor(catalogPrices(ttc, taxRateBps), priceMode),
      taxRateBps,
      perPerson,
    };
  };
  const serviceKeys = ['decoration', 'serveur', 'musique', 'vaisselle'];
  return {
    packages: new Map(
      PACKAGES.map((pkg) => [
        pkg.slug,
        ref(packageIds.get(pkg.slug), pkg.name.fr, pkg.ttcPerPerson, TAX_RATE, true),
      ]),
    ),
    dishes: new Map(
      DISHES.map((dish) => [
        dish.slug,
        ref(
          dishIds.get(dish.slug),
          dish.name.fr,
          dish.ttc,
          dish.taxRateBps ?? TAX_RATE,
          (dish.unit ?? 'PER_PERSON') === 'PER_PERSON',
        ),
      ]),
    ),
    services: new Map(
      EXTRA_SERVICES.map((service, index) => [
        serviceKeys[index] ?? service.id,
        ref(
          service.id,
          service.name.fr,
          service.ttc,
          TAX_RATE,
          service.pricingUnit === 'PER_PERSON',
        ),
      ]),
    ),
  };
}

async function main(): Promise<void> {
  await seedPermissions();
  const traiteur = await seedTraiteur();
  const { users, memberships } = await seedUsers(traiteur.id);
  const { dishIds, packageIds } = await seedCatalog(traiteur.id);
  await seedIllustrations(traiteur.id, dishIds, packageIds);
  await seedDemoOrder(traiteur, memberships, dishIds, packageIds);
  const salmaId = memberships.get('client');
  const adminUserId = users.get('admin');
  if (!salmaId || !adminUserId) throw new Error('Comptes de démonstration manquants');
  await seedDemoClientsAndOrders(
    prisma,
    traiteur,
    salmaId,
    adminUserId,
    demoCatalog(traiteur.priceEntryMode, dishIds, packageIds),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

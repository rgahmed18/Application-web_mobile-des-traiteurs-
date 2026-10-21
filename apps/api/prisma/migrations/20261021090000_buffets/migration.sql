-- Buffets : types (liste gérable), buffets (gamme, prix par personne ou forfait, invités
-- minimum) et composition en plats du catalogue et en éléments libres FR/AR.
-- Généré par Prisma, puis complété à la main : contraintes et types de buffet par défaut.

-- CreateTable
CREATE TABLE "BuffetType" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuffetType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buffet" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "typeId" UUID,
    "rangeId" UUID,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "pricingUnit" "PricingUnit" NOT NULL DEFAULT 'PER_PERSON',
    "priceHt" INTEGER NOT NULL,
    "priceTtc" INTEGER NOT NULL,
    "taxRateBps" INTEGER,
    "minGuests" INTEGER NOT NULL DEFAULT 1,
    "freeItems" JSONB NOT NULL DEFAULT '[]',
    "imageKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buffet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuffetDish" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "buffetId" UUID NOT NULL,
    "dishId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuffetDish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuffetType_traiteurId_sortOrder_idx" ON "BuffetType"("traiteurId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BuffetType_traiteurId_code_key" ON "BuffetType"("traiteurId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BuffetType_id_traiteurId_key" ON "BuffetType"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "Buffet_traiteurId_typeId_idx" ON "Buffet"("traiteurId", "typeId");

-- CreateIndex
CREATE INDEX "Buffet_traiteurId_archivedAt_idx" ON "Buffet"("traiteurId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Buffet_traiteurId_slug_key" ON "Buffet"("traiteurId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Buffet_id_traiteurId_key" ON "Buffet"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "BuffetDish_traiteurId_idx" ON "BuffetDish"("traiteurId");

-- CreateIndex
CREATE UNIQUE INDEX "BuffetDish_buffetId_dishId_key" ON "BuffetDish"("buffetId", "dishId");

-- AddForeignKey
ALTER TABLE "BuffetType" ADD CONSTRAINT "BuffetType_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buffet" ADD CONSTRAINT "Buffet_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buffet" ADD CONSTRAINT "Buffet_typeId_traiteurId_fkey" FOREIGN KEY ("typeId", "traiteurId") REFERENCES "BuffetType"("id", "traiteurId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Buffet" ADD CONSTRAINT "Buffet_rangeId_traiteurId_fkey" FOREIGN KEY ("rangeId", "traiteurId") REFERENCES "CatalogRange"("id", "traiteurId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BuffetDish" ADD CONSTRAINT "BuffetDish_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuffetDish" ADD CONSTRAINT "BuffetDish_buffetId_traiteurId_fkey" FOREIGN KEY ("buffetId", "traiteurId") REFERENCES "Buffet"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuffetDish" ADD CONSTRAINT "BuffetDish_dishId_traiteurId_fkey" FOREIGN KEY ("dishId", "traiteurId") REFERENCES "Dish"("id", "traiteurId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Valeurs ───
ALTER TABLE "Buffet" ADD CONSTRAINT "Buffet_values_check" CHECK (
  "pricingUnit" IN ('PER_PERSON', 'FLAT') AND "priceHt" >= 0 AND "priceTtc" >= 0
  AND "minGuests" >= 1 AND jsonb_typeof("freeItems") = 'array'
);
ALTER TABLE "BuffetDish" ADD CONSTRAINT "BuffetDish_quantity_check" CHECK ("quantity" >= 1);
ALTER TABLE "BuffetType" ADD CONSTRAINT "BuffetType_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,39}$');

-- ─── Listes par défaut : types de buffet en plus ───
CREATE OR REPLACE FUNCTION traiteur_default_lists(target UUID) RETURNS void AS $$
BEGIN
  INSERT INTO "EventType" ("id", "traiteurId", "code", "name", "sortOrder", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, CURRENT_TIMESTAMP
  FROM (VALUES
    ('WEDDING',    '{"fr": "Mariage", "ar": "عرس"}'::jsonb, 0),
    ('ENGAGEMENT', '{"fr": "Fiançailles", "ar": "خطوبة"}'::jsonb, 1),
    ('BIRTHDAY',   '{"fr": "Anniversaire", "ar": "عيد ميلاد"}'::jsonb, 2),
    ('AQIQA',      '{"fr": "Aqiqa", "ar": "عقيقة"}'::jsonb, 3),
    ('CORPORATE',  '{"fr": "Événement d’entreprise", "ar": "حفل شركة"}'::jsonb, 4),
    ('THESIS',     '{"fr": "Soutenance", "ar": "مناقشة أطروحة"}'::jsonb, 5),
    ('OTHER',      '{"fr": "Autre", "ar": "أخرى"}'::jsonb, 6)
  ) AS d(code, name, position)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;

  INSERT INTO "CatalogRange" ("id", "traiteurId", "code", "name", "sortOrder", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, CURRENT_TIMESTAMP
  FROM (VALUES
    ('STANDARD', '{"fr": "Standard", "ar": "عادية"}'::jsonb, 0),
    ('PREMIUM',  '{"fr": "Premium", "ar": "ممتازة"}'::jsonb, 1),
    ('LUXE',     '{"fr": "Luxe", "ar": "فاخرة"}'::jsonb, 2)
  ) AS d(code, name, position)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;

  INSERT INTO "EquipmentCategory" ("id", "traiteurId", "code", "name", "sortOrder", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, CURRENT_TIMESTAMP
  FROM (VALUES
    ('CHAIRS',      '{"fr": "Chaises", "ar": "كراسي"}'::jsonb, 0),
    ('TABLES',      '{"fr": "Tables", "ar": "طاولات"}'::jsonb, 1),
    ('LINENS',      '{"fr": "Nappes", "ar": "أغطية الطاولات"}'::jsonb, 2),
    ('COVERS',      '{"fr": "Housses", "ar": "أغطية الكراسي"}'::jsonb, 3),
    ('TABLEWARE',   '{"fr": "Vaisselle", "ar": "أواني"}'::jsonb, 4),
    ('ACCESSORIES', '{"fr": "Accessoires", "ar": "إكسسوارات"}'::jsonb, 5),
    ('FLORAL',      '{"fr": "Décoration florale", "ar": "تزيين بالورود"}'::jsonb, 6),
    ('LIGHTING',    '{"fr": "Éclairage", "ar": "إضاءة"}'::jsonb, 7)
  ) AS d(code, name, position)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;

  INSERT INTO "BuffetType" ("id", "traiteurId", "code", "name", "sortOrder", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, CURRENT_TIMESTAMP
  FROM (VALUES
    ('MOROCCAN', '{"fr": "Buffet marocain", "ar": "بوفيه مغربي"}'::jsonb, 0),
    ('ORIENTAL', '{"fr": "Buffet oriental", "ar": "بوفيه شرقي"}'::jsonb, 1),
    ('SWEET',    '{"fr": "Buffet sucré", "ar": "بوفيه الحلويات"}'::jsonb, 2),
    ('TEA',      '{"fr": "Buffet thé", "ar": "بوفيه الشاي"}'::jsonb, 3)
  ) AS d(code, name, position)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Traiteurs existants (idempotent)
SELECT traiteur_default_lists("id") FROM "Traiteur";

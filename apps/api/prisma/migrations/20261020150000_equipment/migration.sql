-- Matériel de fête : catégories (liste gérable), articles (location, remplacement, stock),
-- délais d'occupation (installation avant, retour après l'événement) du traiteur et de chaque
-- commande, référence au matériel sur les lignes de commande (disponibilité par période).
-- Généré par Prisma, clé SET NULL réécrite (patch-set-null), puis complété à la main :
-- contraintes de valeurs et catégories par défaut.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "equipmentReturnHours" INTEGER,
ADD COLUMN     "equipmentSetupHours" INTEGER;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "equipmentId" UUID;

-- AlterTable
ALTER TABLE "Traiteur" ADD COLUMN     "equipmentReturnHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "equipmentSetupHours" INTEGER NOT NULL DEFAULT 12;

-- CreateTable
CREATE TABLE "EquipmentCategory" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentItem" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "categoryId" UUID,
    "rangeId" UUID,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "priceHt" INTEGER NOT NULL,
    "priceTtc" INTEGER NOT NULL,
    "replacementPriceHt" INTEGER NOT NULL DEFAULT 0,
    "replacementPriceTtc" INTEGER NOT NULL DEFAULT 0,
    "taxRateBps" INTEGER,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "imageKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentCategory_traiteurId_sortOrder_idx" ON "EquipmentCategory"("traiteurId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentCategory_traiteurId_code_key" ON "EquipmentCategory"("traiteurId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentCategory_id_traiteurId_key" ON "EquipmentCategory"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "EquipmentItem_traiteurId_categoryId_idx" ON "EquipmentItem"("traiteurId", "categoryId");

-- CreateIndex
CREATE INDEX "EquipmentItem_traiteurId_archivedAt_idx" ON "EquipmentItem"("traiteurId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentItem_traiteurId_slug_key" ON "EquipmentItem"("traiteurId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentItem_id_traiteurId_key" ON "EquipmentItem"("id", "traiteurId");

-- CreateIndex
CREATE INDEX "OrderItem_traiteurId_equipmentId_idx" ON "OrderItem"("traiteurId", "equipmentId");

-- AddForeignKey
ALTER TABLE "EquipmentCategory" ADD CONSTRAINT "EquipmentCategory_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentItem" ADD CONSTRAINT "EquipmentItem_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentItem" ADD CONSTRAINT "EquipmentItem_categoryId_traiteurId_fkey" FOREIGN KEY ("categoryId", "traiteurId") REFERENCES "EquipmentCategory"("id", "traiteurId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EquipmentItem" ADD CONSTRAINT "EquipmentItem_rangeId_traiteurId_fkey" FOREIGN KEY ("rangeId", "traiteurId") REFERENCES "CatalogRange"("id", "traiteurId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_equipmentId_traiteurId_fkey" FOREIGN KEY ("equipmentId", "traiteurId") REFERENCES "EquipmentItem"("id", "traiteurId") ON DELETE SET NULL ("equipmentId") ON UPDATE CASCADE;


-- ─── Valeurs ───
ALTER TABLE "EquipmentItem" ADD CONSTRAINT "EquipmentItem_values_check" CHECK (
  "stockQuantity" >= 0 AND "priceHt" >= 0 AND "priceTtc" >= 0
  AND "replacementPriceHt" >= 0 AND "replacementPriceTtc" >= 0
);
ALTER TABLE "EquipmentCategory" ADD CONSTRAINT "EquipmentCategory_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,39}$');
ALTER TABLE "Traiteur" ADD CONSTRAINT "Traiteur_equipment_hours_check" CHECK (
  "equipmentSetupHours" BETWEEN 0 AND 240 AND "equipmentReturnHours" BETWEEN 0 AND 240
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_equipment_hours_check" CHECK (
  ("equipmentSetupHours" IS NULL OR "equipmentSetupHours" BETWEEN 0 AND 240)
  AND ("equipmentReturnHours" IS NULL OR "equipmentReturnHours" BETWEEN 0 AND 240)
);

-- ─── Listes par défaut : catégories de matériel en plus des types et des gammes ───
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
END;
$$ LANGUAGE plpgsql;

-- Traiteurs existants (idempotent : types et gammes déjà présents conservés)
SELECT traiteur_default_lists("id") FROM "Traiteur";

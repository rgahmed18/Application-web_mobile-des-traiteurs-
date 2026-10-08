-- Catalogue : photos par clé de stockage, archivage, suivi des envois de photos.
-- Écrite à la main pour renommer (et non supprimer puis recréer) les colonnes existantes.

-- CreateEnum
CREATE TYPE "MediaUploadStatus" AS ENUM ('PENDING', 'READY', 'ATTACHED', 'DETACHED');

-- Photos : la base stocke une clé de stockage, plus une URL (renommage sans perte de données)
ALTER TABLE "Dish" RENAME COLUMN "imageUrl" TO "imageKey";
ALTER TABLE "Package" RENAME COLUMN "imageUrl" TO "imageKey";

-- Archivage : un élément utilisé dans une commande ou un devis n'est jamais supprimé
ALTER TABLE "Dish" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Package" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "ExtraService" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MediaUpload" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "status" "MediaUploadStatus" NOT NULL DEFAULT 'PENDING',
    "rawKey" TEXT NOT NULL,
    "imageKey" TEXT,
    "entityType" TEXT,
    "entityId" UUID,
    "detachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaUpload_imageKey_key" ON "MediaUpload"("imageKey");

-- CreateIndex
CREATE INDEX "MediaUpload_status_createdAt_idx" ON "MediaUpload"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MediaUpload_status_detachedAt_idx" ON "MediaUpload"("status", "detachedAt");

-- CreateIndex
CREATE INDEX "MediaUpload_traiteurId_idx" ON "MediaUpload"("traiteurId");

-- CreateIndex
CREATE INDEX "Dish_traiteurId_archivedAt_idx" ON "Dish"("traiteurId", "archivedAt");

-- AddForeignKey
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── SQL ajouté manuellement ───

-- Cohérence des états d'une photo : traitée ⇒ clé, rattachée ⇒ élément, détachée ⇒ date
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_state_check" CHECK (
  ("status" = 'PENDING' OR "imageKey" IS NOT NULL)
  AND ("status" <> 'ATTACHED' OR ("entityType" IS NOT NULL AND "entityId" IS NOT NULL))
  AND ("status" <> 'DETACHED' OR "detachedAt" IS NOT NULL)
);

-- Permission renommée catalog.manage → catalog.write ; les surcharges des traiteurs sont conservées
UPDATE "Permission"
   SET "key" = 'catalog.write', "description" = 'Créer et modifier plats, formules et services'
 WHERE "key" = 'catalog.manage';

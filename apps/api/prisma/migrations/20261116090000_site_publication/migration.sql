-- « Publié sur le site » : choix du traiteur, distinct de « Disponible » (isActive).
-- Désactivé par défaut pour les nouveaux éléments ; les éléments existants restent publiés.
-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ExtraService" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EquipmentItem" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Buffet" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Package" SET "isPublished" = true;
UPDATE "ExtraService" SET "isPublished" = true;
UPDATE "EquipmentItem" SET "isPublished" = true;
UPDATE "Buffet" SET "isPublished" = true;

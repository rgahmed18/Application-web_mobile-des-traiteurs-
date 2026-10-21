-- Matériel et buffets dans les lignes des commandes, devis et factures.
-- Le champ libre « Matériel » de la commande est remplacé par des lignes de matériel du
-- catalogue : son contenu est conservé dans les notes de service.

-- AlterEnum (PostgreSQL 12+ : plusieurs valeurs dans une même migration)
ALTER TYPE "LineItemType" ADD VALUE 'EQUIPMENT';
ALTER TYPE "LineItemType" ADD VALUE 'BUFFET';

-- Ancien champ libre → notes de service
UPDATE "Order"
SET "serviceNotes" = CASE
  WHEN "serviceNotes" IS NULL OR btrim("serviceNotes") = ''
    THEN 'Matériel (ancien champ) : ' || btrim("equipment")
  ELSE "serviceNotes" || E'\n\nMatériel (ancien champ) : ' || btrim("equipment")
END
WHERE "equipment" IS NOT NULL AND btrim("equipment") <> '';

-- Contrôles différés (totaux = somme des lignes) exécutés avant de modifier la table
SET CONSTRAINTS ALL IMMEDIATE;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "equipment";

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "buffetId" UUID;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "buffetId" UUID,
ADD COLUMN     "equipmentId" UUID;

-- CreateIndex
CREATE INDEX "OrderItem_traiteurId_buffetId_idx" ON "OrderItem"("traiteurId", "buffetId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_buffetId_traiteurId_fkey" FOREIGN KEY ("buffetId", "traiteurId") REFERENCES "Buffet"("id", "traiteurId") ON DELETE SET NULL ("buffetId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_equipmentId_traiteurId_fkey" FOREIGN KEY ("equipmentId", "traiteurId") REFERENCES "EquipmentItem"("id", "traiteurId") ON DELETE SET NULL ("equipmentId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_buffetId_traiteurId_fkey" FOREIGN KEY ("buffetId", "traiteurId") REFERENCES "Buffet"("id", "traiteurId") ON DELETE SET NULL ("buffetId") ON UPDATE CASCADE;

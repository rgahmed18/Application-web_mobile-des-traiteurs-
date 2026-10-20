-- Menus et formules : gamme (facultative) et types d'événement associés.
-- Aucune reprise de données : colonne facultative et table de liaison nouvelles.
-- NO ACTION (vérifiée en fin d'instruction) : une gamme ou un type relié à un menu ne se
-- supprime pas (l'API propose l'archivage) ; la suppression d'un traiteur reste possible.

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "rangeId" UUID;

-- CreateTable
CREATE TABLE "PackageEventType" (
    "traiteurId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "eventTypeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageEventType_pkey" PRIMARY KEY ("packageId","eventTypeId")
);

-- CreateIndex
CREATE INDEX "PackageEventType_traiteurId_eventTypeId_idx" ON "PackageEventType"("traiteurId", "eventTypeId");

-- CreateIndex
CREATE INDEX "Package_traiteurId_rangeId_idx" ON "Package"("traiteurId", "rangeId");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_rangeId_traiteurId_fkey" FOREIGN KEY ("rangeId", "traiteurId") REFERENCES "CatalogRange"("id", "traiteurId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PackageEventType" ADD CONSTRAINT "PackageEventType_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEventType" ADD CONSTRAINT "PackageEventType_packageId_traiteurId_fkey" FOREIGN KEY ("packageId", "traiteurId") REFERENCES "Package"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEventType" ADD CONSTRAINT "PackageEventType_eventTypeId_traiteurId_fkey" FOREIGN KEY ("eventTypeId", "traiteurId") REFERENCES "EventType"("id", "traiteurId") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Suspension d'un traiteur par la plateforme : date et motif.
-- AlterTable
ALTER TABLE "Traiteur" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;


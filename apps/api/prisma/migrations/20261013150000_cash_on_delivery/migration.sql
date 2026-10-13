-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "assignmentId" UUID,
ADD COLUMN     "chequePhotoKey" TEXT,
ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "collectedById" UUID,
ADD COLUMN     "remittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StaffAssignment" ADD COLUMN     "cashMethod" "PaymentMethod",
ADD COLUMN     "cashToCollect" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_id_traiteurId_key" ON "StaffAssignment"("id", "traiteurId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedById_traiteurId_fkey" FOREIGN KEY ("collectedById", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_assignmentId_traiteurId_fkey" FOREIGN KEY ("assignmentId", "traiteurId") REFERENCES "StaffAssignment"("id", "traiteurId") ON DELETE SET NULL ON UPDATE CASCADE;



-- ─────────────── Écrit à la main : garanties portées par la base ───────────────

-- Montant à encaisser à la livraison : montant positif et mode (espèces ou chèque) ensemble
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_cash_check" CHECK (
  ("cashToCollect" IS NULL AND "cashMethod" IS NULL)
  OR ("cashToCollect" > 0 AND "cashMethod" IN ('CASH', 'CHEQUE'))
);

-- Les champs d'encaissement à la livraison n'existent que sur un encaissement déclaré ; une
-- remise n'existe que sur un encaissement déclaré, validé avec son reçu.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collection_check" CHECK (
  ("collectedAt" IS NOT NULL OR ("assignmentId" IS NULL AND "collectedById" IS NULL
    AND "chequePhotoKey" IS NULL AND "remittedAt" IS NULL))
  AND ("remittedAt" IS NULL OR "receiptNumber" IS NOT NULL)
  AND ("collectedAt" IS NULL OR "type" <> 'REFUND')
);

-- Une seule déclaration vivante (en attente ou remise) par affectation ; un refus en libère la place
CREATE UNIQUE INDEX "Payment_assignment_live_key" ON "Payment"("assignmentId")
  WHERE "assignmentId" IS NOT NULL AND "voidedAt" IS NULL;

-- Encaissements immuables, avec une seule transition supplémentaire : la remise d'un encaissement
-- déclaré par le livreur (en attente → réussi), qui fixe sa nature, son reçu et sa date de remise.
CREATE OR REPLACE FUNCTION payment_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  remitting boolean := OLD."status" = 'PENDING' AND OLD."collectedAt" IS NOT NULL
    AND OLD."receiptNumber" IS NULL AND NEW."status" = 'SUCCEEDED';
BEGIN
  IF NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."traiteurId" IS DISTINCT FROM OLD."traiteurId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR (NEW."type" IS DISTINCT FROM OLD."type" AND NOT remitting)
     OR NEW."method" IS DISTINCT FROM OLD."method"
     OR NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR (NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber" AND NOT remitting)
     OR (OLD."voidedAt" IS NOT NULL AND NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt")
     OR (OLD."receiptPdfKey" IS NOT NULL AND NEW."receiptPdfKey" IS DISTINCT FROM OLD."receiptPdfKey")
     OR (OLD."receiptPdfSha256" IS NOT NULL AND NEW."receiptPdfSha256" IS DISTINCT FROM OLD."receiptPdfSha256")
     OR NEW."collectedAt" IS DISTINCT FROM OLD."collectedAt"
     OR NEW."chequePhotoKey" IS DISTINCT FROM OLD."chequePhotoKey"
     OR (NEW."remittedAt" IS DISTINCT FROM OLD."remittedAt" AND NOT remitting)
     OR (NEW."assignmentId" IS DISTINCT FROM OLD."assignmentId" AND NEW."assignmentId" IS NOT NULL)
     OR (OLD."status" IN ('SUCCEEDED', 'VOIDED', 'REFUNDED', 'FAILED')
         AND NEW."status" IS DISTINCT FROM OLD."status" AND NEW."status" <> 'VOIDED')
  THEN
    RAISE EXCEPTION 'Paiement % : un encaissement enregistré ne peut pas être modifié', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

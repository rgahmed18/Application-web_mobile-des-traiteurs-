-- CreateEnum
CREATE TYPE "CreditNoteNumbering" AS ENUM ('SEPARATE', 'SHARED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'RECEIPT';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'VOIDED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancellationFeeAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "receiptNumber" TEXT,
ADD COLUMN     "receiptPdfKey" TEXT,
ADD COLUMN     "receiptPdfSha256" TEXT,
ADD COLUMN     "receiptSequence" INTEGER,
ADD COLUMN     "receiptYear" INTEGER,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Traiteur" ADD COLUMN     "balanceDueDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "cancellationFeeTaxRateBps" INTEGER,
ADD COLUMN     "creditNoteNumbering" "CreditNoteNumbering" NOT NULL DEFAULT 'SEPARATE',
ADD COLUMN     "depositPercentBps" INTEGER NOT NULL DEFAULT 3000,
ADD COLUMN     "legalForm" TEXT,
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "paymentTerms" JSONB,
ADD COLUMN     "quoteTerms" JSONB,
ADD COLUMN     "quoteValidityDays" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "rcCourt" TEXT,
ADD COLUMN     "shareCapital" INTEGER;

-- CreateIndex
CREATE INDEX "Payment_traiteurId_paidAt_idx" ON "Payment"("traiteurId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_traiteurId_receiptNumber_key" ON "Payment"("traiteurId", "receiptNumber");


-- ─────────────── Écrit à la main : garanties portées par la base ───────────────

ALTER TABLE "Traiteur" ADD CONSTRAINT "Traiteur_billing_check" CHECK (
  "depositPercentBps" BETWEEN 0 AND 10000
  AND "balanceDueDays" BETWEEN 0 AND 90
  AND "quoteValidityDays" BETWEEN 1 AND 365
  AND ("cancellationFeeTaxRateBps" IS NULL OR "cancellationFeeTaxRateBps" BETWEEN 0 AND 10000)
);

ALTER TABLE "Order" ADD CONSTRAINT "Order_payment_amounts_check"
  CHECK ("depositAmount" >= 0 AND "cancellationFeeAmount" >= 0);

-- Un encaissement annulé porte toujours son motif ; un reçu est complet ou absent
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_void_check"
  CHECK ("voidedAt" IS NULL OR length(btrim(coalesce("voidReason", ''))) > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receipt_check" CHECK (
  ("receiptNumber" IS NULL AND "receiptYear" IS NULL AND "receiptSequence" IS NULL)
  OR ("receiptNumber" IS NOT NULL AND "receiptYear" IS NOT NULL AND "receiptSequence" IS NOT NULL)
);

-- Un encaissement enregistré ne se modifie pas : seuls l'annulation (une fois) et le PDF du
-- reçu (une fois) peuvent être renseignés. Une erreur se corrige en annulant puis en ressaisissant.
CREATE FUNCTION payment_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."traiteurId" IS DISTINCT FROM OLD."traiteurId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."method" IS DISTINCT FROM OLD."method"
     OR NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber"
     OR (OLD."voidedAt" IS NOT NULL AND NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt")
     OR (OLD."receiptPdfKey" IS NOT NULL AND NEW."receiptPdfKey" IS DISTINCT FROM OLD."receiptPdfKey")
     OR (OLD."receiptPdfSha256" IS NOT NULL AND NEW."receiptPdfSha256" IS DISTINCT FROM OLD."receiptPdfSha256")
  THEN
    RAISE EXCEPTION 'Paiement % : un encaissement enregistré ne peut pas être modifié', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Payment_immutable"
  BEFORE UPDATE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION payment_prevent_mutation();

-- Ni suppression : l'historique des encaissements (et la numérotation des reçus) est conservé
CREATE FUNCTION payment_prevent_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Paiement % : un encaissement ne se supprime pas, il s''annule', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "Payment_no_delete"
  BEFORE DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION payment_prevent_delete();

-- Payé net (encaissements − remboursements, hors annulés) compris entre 0 et le total TTC de la
-- commande : vérifié en fin de transaction (ajout de lignes et paiement dans une même opération).
CREATE FUNCTION order_check_payments(target_order uuid, target_traiteur uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  net bigint;
  total integer;
BEGIN
  SELECT "totalTtc" INTO total FROM "Order" WHERE "id" = target_order AND "traiteurId" = target_traiteur;
  IF total IS NULL THEN RETURN; END IF;
  SELECT coalesce(sum(CASE WHEN "type" = 'REFUND' THEN -"amount" ELSE "amount" END), 0) INTO net
  FROM "Payment"
  WHERE "orderId" = target_order AND "traiteurId" = target_traiteur
    AND "status" = 'SUCCEEDED' AND "voidedAt" IS NULL;
  IF net < 0 THEN
    RAISE EXCEPTION 'Commande % : remboursements supérieurs aux encaissements', target_order
      USING ERRCODE = 'check_violation';
  END IF;
  IF net > total THEN
    RAISE EXCEPTION 'Commande % : payé (%) supérieur au total TTC (%)', target_order, net, total
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION payment_check_order_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM order_check_payments(NEW."orderId", NEW."traiteurId");
  RETURN NULL;
END;
$$;

CREATE FUNCTION order_check_payments_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM order_check_payments(NEW."id", NEW."traiteurId");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Payment_within_order_total"
  AFTER INSERT OR UPDATE ON "Payment"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payment_check_order_trigger();

CREATE CONSTRAINT TRIGGER "Order_total_covers_payments"
  AFTER UPDATE OF "totalTtc" ON "Order"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION order_check_payments_trigger();

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('TOTAL', 'DEPOSIT', 'BALANCE', 'CANCELLATION_FEE');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'TOTAL',
ADD COLUMN     "locale" "Locale" NOT NULL DEFAULT 'fr',
ADD COLUMN     "pdfKey" TEXT,
ADD COLUMN     "pdfSha256" TEXT,
ADD COLUMN     "pdfTemplate" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "companyIce" TEXT,
ADD COLUMN     "companyName" TEXT;



-- ─────────────── Écrit à la main : garanties portées par la base ───────────────

-- ICE d'un client entreprise : 15 chiffres
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_company_ice_check"
  CHECK ("companyIce" IS NULL OR "companyIce" ~ '^[0-9]{15}$');

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_pdf_check" CHECK (
  ("pdfKey" IS NULL AND "pdfSha256" IS NULL AND "pdfTemplate" IS NULL)
  OR ("pdfKey" IS NOT NULL AND "pdfSha256" ~ '^[0-9a-f]{64}$' AND "pdfTemplate" IS NOT NULL)
);

-- Date d'émission : toujours l'heure de la transaction, jamais antidatée ni postdatée
CREATE FUNCTION invoice_issue_now() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."issuedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Invoice_issued_now"
  BEFORE INSERT ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_issue_now();

-- Immuabilité : seul le PDF figé peut être renseigné, une seule fois (puis plus jamais modifié)
CREATE OR REPLACE FUNCTION invoice_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Facture % immuable : suppression interdite', OLD."id";
  END IF;
  IF (to_jsonb(NEW) - 'pdfUrl' - 'updatedAt' - 'pdfKey' - 'pdfSha256' - 'pdfTemplate')
     IS DISTINCT FROM (to_jsonb(OLD) - 'pdfUrl' - 'updatedAt' - 'pdfKey' - 'pdfSha256' - 'pdfTemplate') THEN
    RAISE EXCEPTION 'Facture % immuable : toute correction passe par un avoir', OLD."id";
  END IF;
  IF OLD."pdfKey" IS NOT NULL AND (
    NEW."pdfKey" IS DISTINCT FROM OLD."pdfKey"
    OR NEW."pdfSha256" IS DISTINCT FROM OLD."pdfSha256"
    OR NEW."pdfTemplate" IS DISTINCT FROM OLD."pdfTemplate"
  ) THEN
    RAISE EXCEPTION 'Facture % : le PDF émis ne se régénère pas', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;

-- Cohérence (fin de transaction) : en plus des contrôles existants, un avoir garde la nature de
-- la facture d'origine et le total des avoirs d'une facture ne dépasse jamais son montant.
CREATE OR REPLACE FUNCTION invoice_check_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id          uuid;
  invoice            record;
  original           record;
  sums               record;
  expected_breakdown jsonb;
  credited           bigint;
BEGIN
  IF TG_TABLE_NAME = 'Invoice' THEN
    target_id := NEW."id";
  ELSE
    target_id := NEW."invoiceId";
  END IF;

  SELECT "type", "kind", "orderId", "totalHt", "totalTax", "totalTtc", "taxBreakdown", "originalInvoiceId"
    INTO invoice FROM "Invoice" WHERE "id" = target_id;

  SELECT COUNT(*) AS line_count,
         COALESCE(SUM("totalHt"), 0) AS ht,
         COALESCE(SUM("taxAmount"), 0) AS tax,
         COALESCE(SUM("totalTtc"), 0) AS ttc
    INTO sums FROM "InvoiceLine" WHERE "invoiceId" = target_id;

  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('taxRateBps', rate, 'baseHt', base_ht, 'taxAmount', tax)
                     ORDER BY rate),
           '[]'::jsonb)
    INTO expected_breakdown
    FROM (SELECT "taxRateBps" AS rate, SUM("totalHt") AS base_ht, SUM("taxAmount") AS tax
            FROM "InvoiceLine" WHERE "invoiceId" = target_id
           GROUP BY "taxRateBps") AS by_rate;

  IF sums.line_count = 0 THEN
    RAISE EXCEPTION 'Facture % sans ligne', target_id USING ERRCODE = 'check_violation';
  END IF;
  IF invoice."totalHt" <> sums.ht OR invoice."totalTax" <> sums.tax OR invoice."totalTtc" <> sums.ttc THEN
    RAISE EXCEPTION 'Facture % : totaux incohérents avec les lignes', target_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF invoice."taxBreakdown" <> expected_breakdown THEN
    RAISE EXCEPTION 'Facture % : récapitulatif de TVA incohérent avec les lignes', target_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF invoice."type" = 'CREDIT_NOTE' THEN
    SELECT "type", "kind", "orderId", "totalTtc" INTO original
      FROM "Invoice" WHERE "id" = invoice."originalInvoiceId";
    IF original."type" IS DISTINCT FROM 'INVOICE' THEN
      RAISE EXCEPTION 'Avoir % : la référence doit être une facture', target_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF original."kind" <> invoice."kind" OR original."orderId" <> invoice."orderId" THEN
      RAISE EXCEPTION 'Avoir % : même commande et même nature que la facture d''origine', target_id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM("totalTtc"), 0) INTO credited
      FROM "Invoice" WHERE "originalInvoiceId" = invoice."originalInvoiceId";
    IF original."totalTtc" + credited < 0 THEN
      RAISE EXCEPTION 'Avoir % : les avoirs dépassent le montant de la facture d''origine', target_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

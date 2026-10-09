-- CreateEnum
CREATE TYPE "AcceptanceMode" AS ENUM ('ONLINE', 'PHONE', 'PAPER', 'OTHER');

-- CreateEnum
CREATE TYPE "QuoteSupersededReason" AS ENUM ('NEW_VERSION', 'ORDER_CHANGED');

-- AlterEnum
ALTER TYPE "QuoteStatus" ADD VALUE 'SUPERSEDED';

-- DropIndex
DROP INDEX "Quote_traiteurId_reference_key";

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "acceptanceAttachmentKey" TEXT,
ADD COLUMN     "acceptanceMode" "AcceptanceMode",
ADD COLUMN     "acceptanceNote" TEXT,
ADD COLUMN     "acceptedByName" TEXT,
ADD COLUMN     "acceptedIp" TEXT,
ADD COLUMN     "acceptedName" TEXT,
ADD COLUMN     "acceptedUserAgent" TEXT,
ADD COLUMN     "availabilityPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locale" "Locale" NOT NULL DEFAULT 'fr',
ADD COLUMN     "pdfKey" TEXT,
ADD COLUMN     "pdfSha256" TEXT,
ADD COLUMN     "pdfTemplate" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededReason" "QuoteSupersededReason";

-- CreateTable
CREATE TABLE "QuoteLink" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLink_tokenHash_key" ON "QuoteLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteLink_traiteurId_quoteId_idx" ON "QuoteLink"("traiteurId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_traiteurId_reference_version_key" ON "Quote"("traiteurId", "reference", "version");

-- AddForeignKey
ALTER TABLE "QuoteLink" ADD CONSTRAINT "QuoteLink_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLink" ADD CONSTRAINT "QuoteLink_quoteId_traiteurId_fkey" FOREIGN KEY ("quoteId", "traiteurId") REFERENCES "Quote"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────── Écrit à la main : garanties portées par la base ───────────────

-- Devis déjà acceptés (données de démonstration) : mode d'accord renseigné
UPDATE "Quote" SET "acceptanceMode" = 'OTHER', "acceptedName" = coalesce("acceptedName", '—')
WHERE "acceptedAt" IS NOT NULL AND "acceptanceMode" IS NULL;

-- Un accord porte toujours son mode et le nom de la personne
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_acceptance_check" CHECK (
  ("acceptedAt" IS NULL AND "acceptanceMode" IS NULL)
  OR ("acceptedAt" IS NOT NULL AND "acceptanceMode" IS NOT NULL
      AND length(btrim(coalesce("acceptedName", ''))) > 0)
);

ALTER TABLE "QuoteLink" ADD CONSTRAINT "QuoteLink_view_count_check" CHECK ("viewCount" >= 0);

-- Les lignes d'un devis ne changent plus une fois le devis envoyé : seul un brouillon se modifie
-- (une évolution de la commande donne une nouvelle version).
CREATE FUNCTION quote_line_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  quote_status text;
  target uuid;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD."quoteId" ELSE NEW."quoteId" END;
  SELECT "status"::text INTO quote_status FROM "Quote" WHERE "id" = target;
  IF quote_status IS NOT NULL AND quote_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Devis % : les lignes d''un devis envoyé ne se modifient plus', target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "QuoteLine_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "QuoteLine"
  FOR EACH ROW EXECUTE FUNCTION quote_line_frozen();

-- Brouillons des formulaires du back-office, côté serveur (liés à l'utilisateur et au traiteur)
-- CreateTable
CREATE TABLE "FormDraft" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "platformAccessId" UUID,
    "formKey" TEXT NOT NULL,
    "label" TEXT,
    "baseVersion" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormDraft_expiresAt_idx" ON "FormDraft"("expiresAt");

-- CreateIndex
CREATE INDEX "FormDraft_platformAccessId_idx" ON "FormDraft"("platformAccessId");

-- CreateIndex
CREATE UNIQUE INDEX "FormDraft_userId_traiteurId_formKey_key" ON "FormDraft"("userId", "traiteurId", "formKey");

-- AddForeignKey
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_platformAccessId_fkey" FOREIGN KEY ("platformAccessId") REFERENCES "PlatformAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Clé de formulaire connue (voir packages/shared/src/drafts) et taille bornée
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_formKey_check"
  CHECK ("formKey" ~ '^((order|quote|client|dish|package|service|equipment|buffet):(new|[0-9a-f-]{36})|settings:(company|billing|pricing|availability))$');
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_size_check"
  CHECK (octet_length("data"::text) <= 200000);

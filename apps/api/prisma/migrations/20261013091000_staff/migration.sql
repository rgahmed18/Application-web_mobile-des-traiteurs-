-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;

-- CreateTable
CREATE TABLE "StaffInvitation" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffInvitation_traiteurId_membershipId_idx" ON "StaffInvitation"("traiteurId", "membershipId");

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_membershipId_traiteurId_fkey" FOREIGN KEY ("membershipId", "traiteurId") REFERENCES "Membership"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;



-- ─────────────── Écrit à la main : garanties portées par la base ───────────────

-- Membres déjà suspendus : date de suspension renseignée
UPDATE "Membership" SET "suspendedAt" = "updatedAt" WHERE "status" = 'SUSPENDED' AND "suspendedAt" IS NULL;

-- Statut suspendu ⇔ date de suspension
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_suspension_check"
  CHECK (("status" = 'SUSPENDED') = ("suspendedAt" IS NOT NULL));

-- Une seule invitation en cours par membre (les précédentes sont révoquées ou utilisées)
CREATE UNIQUE INDEX "StaffInvitation_one_open_per_member"
  ON "StaffInvitation" ("membershipId") WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;

ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_dates_check"
  CHECK ("expiresAt" > "createdAt" AND ("usedAt" IS NULL OR "revokedAt" IS NULL));

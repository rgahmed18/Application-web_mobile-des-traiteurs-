-- Accès d'un super admin chez un traiteur (motif, durée, sortie) et sessions qui en dépendent.
-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "platformAccessId" UUID;

-- CreateTable
CREATE TABLE "PlatformAccess" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "extensions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAccess_userId_endedAt_idx" ON "PlatformAccess"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "PlatformAccess_traiteurId_startedAt_idx" ON "PlatformAccess"("traiteurId", "startedAt");

-- AddForeignKey
ALTER TABLE "PlatformAccess" ADD CONSTRAINT "PlatformAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAccess" ADD CONSTRAINT "PlatformAccess_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_platformAccessId_fkey" FOREIGN KEY ("platformAccessId") REFERENCES "PlatformAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "PlatformAccess" ADD CONSTRAINT "PlatformAccess_end_reason_check"
  CHECK ("endReason" IS NULL OR "endReason" IN ('LEFT', 'EXPIRED'));
ALTER TABLE "PlatformAccess" ADD CONSTRAINT "PlatformAccess_reason_check" CHECK (length(btrim("reason")) >= 3);

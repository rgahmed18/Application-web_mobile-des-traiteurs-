-- AlterTable
ALTER TABLE "OtpCode" ADD COLUMN     "smsSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OtpCode_ipAddress_createdAt_idx" ON "OtpCode"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_smsSentAt_idx" ON "OtpCode"("smsSentAt");

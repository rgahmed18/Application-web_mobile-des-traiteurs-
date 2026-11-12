-- Codes de vérification envoyés par e-mail (numéros étrangers, sans SMS)
-- Contrainte : un code e-mail porte son adresse ; chaque canal n'a que sa date d'envoi
-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('SMS', 'EMAIL');

-- AlterTable
ALTER TABLE "OtpCode" ADD COLUMN     "channel" "OtpChannel" NOT NULL DEFAULT 'SMS',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OtpCode_email_createdAt_idx" ON "OtpCode"("email", "createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_emailSentAt_idx" ON "OtpCode"("emailSentAt");


ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_channel_check"
  CHECK (("channel" = 'EMAIL') = ("email" IS NOT NULL) AND ("channel" = 'SMS' OR "smsSentAt" IS NULL)
    AND ("channel" = 'EMAIL' OR "emailSentAt" IS NULL));

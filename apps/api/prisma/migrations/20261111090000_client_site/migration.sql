-- Site client : réglages du traiteur, validation et consentement des clients, origine des
-- commandes, notifications du back-office

-- CreateEnum
CREATE TYPE "ClientApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('BACKOFFICE', 'ONLINE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CLIENT_SIGNED_UP', 'CLIENT_APPROVAL_REQUESTED', 'ORDER_REQUESTED', 'ORDER_REQUEST_CANCELLED', 'QUOTE_ACCEPTED', 'QUOTE_REJECTED');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "clientApproval" "ClientApproval" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "clientApprovalAt" TIMESTAMP(3),
ADD COLUMN     "clientApprovalByUserId" UUID,
ADD COLUMN     "clientRejectionReason" TEXT,
ADD COLUMN     "privacyConsentAt" TIMESTAMP(3),
ADD COLUMN     "privacyConsentIp" TEXT,
ADD COLUMN     "privacyPolicyVersion" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'BACKOFFICE';

-- AlterTable
ALTER TABLE "Traiteur" ADD COLUMN     "cndpDeclaration" TEXT,
ADD COLUMN     "privacyExtra" JSONB,
ADD COLUMN     "requireClientApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "siteIntro" JSONB,
ADD COLUMN     "sitePhotoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "notificationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE INDEX "Notification_traiteurId_createdAt_idx" ON "Notification"("traiteurId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationRead_userId_idx" ON "NotificationRead"("userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Accueil : 6 photos au plus
ALTER TABLE "Traiteur" ADD CONSTRAINT "Traiteur_site_photos_check"
  CHECK (cardinality("sitePhotoKeys") <= 6);

-- Motif de refus seulement pour un client refusé (et obligatoire dans ce cas)
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_client_rejection_check"
  CHECK (("clientApproval" = 'REJECTED') = ("clientRejectionReason" IS NOT NULL));

-- Brouillon de l'onglet « Site client » des paramètres
ALTER TABLE "FormDraft" DROP CONSTRAINT "FormDraft_formKey_check";
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_formKey_check"
  CHECK ("formKey" ~ '^((order|quote|client|dish|package|service|equipment|buffet):(new|[0-9a-f-]{36})|settings:(company|billing|pricing|availability|site))$');

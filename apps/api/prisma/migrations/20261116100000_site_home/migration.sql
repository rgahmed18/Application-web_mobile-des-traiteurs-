-- Accueil du site client : palette, bouton WhatsApp, menus et buffets mis en avant, photos propres
-- aux types d'événement.
-- AlterTable
ALTER TABLE "Traiteur" ADD COLUMN     "siteEventTypePhotos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "siteFeatured" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "sitePalette" TEXT NOT NULL DEFAULT 'terracotta',
ADD COLUMN     "siteWhatsappPhone" TEXT;

-- Comparateur des gammes : gamme mise en avant (« Le plus choisi »), par code ; null : aucune.
-- Premium par défaut (gamme créée pour chaque traiteur ; ignorée si elle n'existe pas).
ALTER TABLE "Traiteur" ADD COLUMN "siteHighlightRange" TEXT DEFAULT 'PREMIUM';
ALTER TABLE "Traiteur" ADD CONSTRAINT "Traiteur_siteHighlightRange_check" CHECK (
  "siteHighlightRange" IS NULL OR "siteHighlightRange" ~ '^[A-Z][A-Z0-9_]{0,39}$'
);

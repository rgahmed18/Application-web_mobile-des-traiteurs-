-- Types d'événement et gammes du catalogue : listes gérables par chaque traiteur, traduites.
-- Écrite à la main : reprise des commandes existantes (le type passe d'une énumération figée à
-- un code relié à la liste du traiteur) et listes par défaut créées par la base.

-- ─── Commandes : le type devient un code de la liste du traiteur ───
-- Conversion sur place, en premier : l'énumération "EventType" doit disparaître avant la table
-- du même nom. Pas de perte : les 6 valeurs existent dans la liste par défaut. ALTER TYPE ne
-- déclenche pas "Order_bump_version".
ALTER TABLE "Order" ALTER COLUMN "eventType" TYPE TEXT USING "eventType"::text;
DROP TYPE "EventType";

-- ─── Tables ───
CREATE TABLE "EventType" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogRange" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogRange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventType_traiteurId_sortOrder_idx" ON "EventType"("traiteurId", "sortOrder");
CREATE UNIQUE INDEX "EventType_traiteurId_code_key" ON "EventType"("traiteurId", "code");
CREATE UNIQUE INDEX "EventType_id_traiteurId_key" ON "EventType"("id", "traiteurId");
CREATE INDEX "CatalogRange_traiteurId_sortOrder_idx" ON "CatalogRange"("traiteurId", "sortOrder");
CREATE UNIQUE INDEX "CatalogRange_traiteurId_code_key" ON "CatalogRange"("traiteurId", "code");
CREATE UNIQUE INDEX "CatalogRange_id_traiteurId_key" ON "CatalogRange"("id", "traiteurId");

ALTER TABLE "EventType" ADD CONSTRAINT "EventType_traiteurId_fkey"
  FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogRange" ADD CONSTRAINT "CatalogRange_traiteurId_fkey"
  FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Codes : majuscules, chiffres et _ (stables, référencés par les commandes)
ALTER TABLE "EventType" ADD CONSTRAINT "EventType_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,39}$');
ALTER TABLE "CatalogRange" ADD CONSTRAINT "CatalogRange_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,39}$');

-- ─── Listes par défaut de chaque traiteur ───
-- Mêmes libellés que l'interface. Idempotent : un traiteur qui a déjà un code le garde tel quel.
CREATE FUNCTION traiteur_default_lists(target UUID) RETURNS void AS $$
BEGIN
  INSERT INTO "EventType" ("id", "traiteurId", "code", "name", "sortOrder", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, CURRENT_TIMESTAMP
  FROM (VALUES
    ('WEDDING',    '{"fr": "Mariage", "ar": "عرس"}'::jsonb, 0),
    ('ENGAGEMENT', '{"fr": "Fiançailles", "ar": "خطوبة"}'::jsonb, 1),
    ('BIRTHDAY',   '{"fr": "Anniversaire", "ar": "عيد ميلاد"}'::jsonb, 2),
    ('AQIQA',      '{"fr": "Aqiqa", "ar": "عقيقة"}'::jsonb, 3),
    ('CORPORATE',  '{"fr": "Événement d’entreprise", "ar": "حفل شركة"}'::jsonb, 4),
    ('THESIS',     '{"fr": "Soutenance", "ar": "مناقشة أطروحة"}'::jsonb, 5),
    ('OTHER',      '{"fr": "Autre", "ar": "أخرى"}'::jsonb, 6)
  ) AS d(code, name, position)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;

  INSERT INTO "CatalogRange" ("id", "traiteurId", "code", "name", "sortOrder", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, CURRENT_TIMESTAMP
  FROM (VALUES
    ('STANDARD', '{"fr": "Standard", "ar": "عادية"}'::jsonb, 0),
    ('PREMIUM',  '{"fr": "Premium", "ar": "ممتازة"}'::jsonb, 1),
    ('LUXE',     '{"fr": "Luxe", "ar": "فاخرة"}'::jsonb, 2)
  ) AS d(code, name, position)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;
END;
$$ LANGUAGE plpgsql;

SELECT traiteur_default_lists("id") FROM "Traiteur";

-- Tout nouveau traiteur (CLI create-traiteur, seed, tests) reçoit ses listes par défaut
CREATE FUNCTION traiteur_default_lists_trigger() RETURNS trigger AS $$
BEGIN
  PERFORM traiteur_default_lists(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Traiteur_default_lists"
  AFTER INSERT ON "Traiteur"
  FOR EACH ROW EXECUTE FUNCTION traiteur_default_lists_trigger();

-- ─── Commandes reliées à la liste de leur traiteur ───
-- NO ACTION (vérifiée en fin d'instruction) : la suppression d'un traiteur efface ses commandes
-- et ses types sans conflit ; un type utilisé ne peut pas être supprimé ni changer de code.
ALTER TABLE "Order" ADD CONSTRAINT "Order_traiteurId_eventType_fkey"
  FOREIGN KEY ("traiteurId", "eventType") REFERENCES "EventType"("traiteurId", "code")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Identité visuelle des gammes sur le site client : finition (ivoire, bronze, or) et liste
-- « Ce qui est inclus » (FR/AR). Suggestion de la gamme supérieure dans « Ma demande ».

ALTER TABLE "CatalogRange"
  ADD COLUMN "finish" TEXT NOT NULL DEFAULT 'ivory',
  ADD COLUMN "included" JSONB NOT NULL DEFAULT '{"fr": [], "ar": []}';
ALTER TABLE "CatalogRange" ADD CONSTRAINT "CatalogRange_finish_check" CHECK (
  "finish" IN ('ivory', 'bronze', 'gold') AND jsonb_typeof("included") = 'object'
);

ALTER TABLE "Traiteur" ADD COLUMN "siteUpsell" BOOLEAN NOT NULL DEFAULT true;

-- Gammes par défaut existantes : Premium en bronze, Luxe en or ; « Standard » devient
-- « Essentiel » seulement si le traiteur n'a pas changé son nom.
UPDATE "CatalogRange" SET "finish" = 'bronze' WHERE "code" = 'PREMIUM';
UPDATE "CatalogRange" SET "finish" = 'gold' WHERE "code" = 'LUXE';
UPDATE "CatalogRange" SET "name" = '{"fr": "Essentiel", "ar": "أساسية"}'::jsonb
WHERE "code" = 'STANDARD' AND "name" = '{"fr": "Standard", "ar": "عادية"}'::jsonb;

-- Listes par défaut des nouveaux traiteurs : finitions et nom « Essentiel »
CREATE OR REPLACE FUNCTION traiteur_default_lists(target UUID) RETURNS void AS $$
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

  INSERT INTO "CatalogRange" ("id", "traiteurId", "code", "name", "sortOrder", "finish", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, d.finish, CURRENT_TIMESTAMP
  FROM (VALUES
    ('STANDARD', '{"fr": "Essentiel", "ar": "أساسية"}'::jsonb, 0, 'ivory'),
    ('PREMIUM',  '{"fr": "Premium", "ar": "ممتازة"}'::jsonb, 1, 'bronze'),
    ('LUXE',     '{"fr": "Luxe", "ar": "فاخرة"}'::jsonb, 2, 'gold')
  ) AS d(code, name, position, finish)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;

  INSERT INTO "EquipmentCategory" ("id", "traiteurId", "code", "name", "sortOrder", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, CURRENT_TIMESTAMP
  FROM (VALUES
    ('CHAIRS',      '{"fr": "Chaises", "ar": "كراسي"}'::jsonb, 0),
    ('TABLES',      '{"fr": "Tables", "ar": "طاولات"}'::jsonb, 1),
    ('LINENS',      '{"fr": "Nappes", "ar": "أغطية الطاولات"}'::jsonb, 2),
    ('COVERS',      '{"fr": "Housses", "ar": "أغطية الكراسي"}'::jsonb, 3),
    ('TABLEWARE',   '{"fr": "Vaisselle", "ar": "أواني"}'::jsonb, 4),
    ('ACCESSORIES', '{"fr": "Accessoires", "ar": "إكسسوارات"}'::jsonb, 5),
    ('FLORAL',      '{"fr": "Décoration florale", "ar": "تزيين بالورود"}'::jsonb, 6),
    ('LIGHTING',    '{"fr": "Éclairage", "ar": "إضاءة"}'::jsonb, 7)
  ) AS d(code, name, position)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;

  INSERT INTO "BuffetType" ("id", "traiteurId", "code", "name", "sortOrder", "updatedAt")
  SELECT gen_random_uuid(), target, d.code, d.name, d.position, CURRENT_TIMESTAMP
  FROM (VALUES
    ('MOROCCAN', '{"fr": "Buffet marocain", "ar": "بوفيه مغربي"}'::jsonb, 0),
    ('ORIENTAL', '{"fr": "Buffet oriental", "ar": "بوفيه شرقي"}'::jsonb, 1),
    ('SWEET',    '{"fr": "Buffet sucré", "ar": "بوفيه الحلويات"}'::jsonb, 2),
    ('TEA',      '{"fr": "Buffet thé", "ar": "بوفيه الشاي"}'::jsonb, 3)
  ) AS d(code, name, position)
  ON CONFLICT ("traiteurId", "code") DO NOTHING;
END;
$$ LANGUAGE plpgsql;


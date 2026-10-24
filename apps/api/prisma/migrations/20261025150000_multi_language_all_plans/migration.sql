-- « Français et arabe » inclus dans les trois offres (Basique compris) : activé chez tous les
-- traiteurs existants. Les nouveaux traiteurs le reçoivent par leur offre (PLAN_FEATURES).
INSERT INTO "FeatureFlag" ("id", "traiteurId", "key", "enabled", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'multi_language', true, now(), now()
FROM "Traiteur"
ON CONFLICT ("traiteurId", "key") DO UPDATE SET "enabled" = true, "updatedAt" = now();

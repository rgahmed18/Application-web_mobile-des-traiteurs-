-- Horaire civil des commandes : la date et les heures saisies sont stockées telles quelles
-- (sans fuseau) et deviennent la source de vérité. Les instants UTC "eventDate" et
-- "eventEndDate" restent, dérivés, pour les chevauchements (matériel, planning).
-- Reprise : jour et heures relus dans le fuseau de chaque traiteur.
ALTER TABLE "Order"
  ADD COLUMN "eventDay" DATE,
  ADD COLUMN "startTime" VARCHAR(5),
  ADD COLUMN "endTime" VARCHAR(5),
  ADD COLUMN "endsNextDay" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Order" o SET
  "eventDay" = ((o."eventDate" AT TIME ZONE 'UTC') AT TIME ZONE t."timezone")::date,
  "startTime" = to_char((o."eventDate" AT TIME ZONE 'UTC') AT TIME ZONE t."timezone", 'HH24:MI'),
  "endTime" = CASE WHEN o."eventEndDate" IS NULL THEN NULL
    ELSE to_char((o."eventEndDate" AT TIME ZONE 'UTC') AT TIME ZONE t."timezone", 'HH24:MI') END,
  "endsNextDay" = o."eventEndDate" IS NOT NULL
    AND ((o."eventEndDate" AT TIME ZONE 'UTC') AT TIME ZONE t."timezone")::date
      > ((o."eventDate" AT TIME ZONE 'UTC') AT TIME ZONE t."timezone")::date
FROM "Traiteur" t
WHERE t."id" = o."traiteurId";

ALTER TABLE "Order"
  ALTER COLUMN "eventDay" SET NOT NULL,
  ALTER COLUMN "startTime" SET NOT NULL;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_startTime_check" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "Order_endTime_check" CHECK (
    "endTime" IS NULL OR "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  -- Fin civile et instant de fin vont ensemble ; « fin le lendemain » suppose une fin
  ADD CONSTRAINT "Order_endTime_instant_check" CHECK (("endTime" IS NULL) = ("eventEndDate" IS NULL)),
  ADD CONSTRAINT "Order_endsNextDay_check" CHECK (NOT "endsNextDay" OR "endTime" IS NOT NULL);

CREATE INDEX "Order_traiteurId_eventDay_idx" ON "Order"("traiteurId", "eventDay");

-- Demandes en ligne : nombre d'invités (minimum, maximum) et délai minimum avant l'événement
ALTER TABLE "Traiteur"
  ADD COLUMN "requestMinGuests" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "requestMaxGuests" INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN "requestLeadDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Traiteur"
  ADD CONSTRAINT "Traiteur_requestGuests_check" CHECK (
    "requestMinGuests" >= 1 AND "requestMaxGuests" <= 5000 AND "requestMinGuests" <= "requestMaxGuests"
  ),
  ADD CONSTRAINT "Traiteur_requestLeadDays_check" CHECK ("requestLeadDays" BETWEEN 1 AND 365);

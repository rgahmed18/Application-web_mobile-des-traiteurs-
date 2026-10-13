-- AlterTable
ALTER TABLE "Traiteur" ADD COLUMN     "closedWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];



-- ─────────────── Écrit à la main : garanties portées par la base ───────────────

-- Jours ISO de 1 à 7, sans doublon, et au moins un jour ouvert dans la semaine
CREATE FUNCTION weekdays_valid(days integer[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT days IS NOT NULL
    AND days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
    AND cardinality(days) <= 6
    AND cardinality(days) = (SELECT count(DISTINCT day) FROM unnest(days) AS day);
$$;

ALTER TABLE "Traiteur" ADD CONSTRAINT "Traiteur_closed_weekdays_check"
  CHECK (weekdays_valid("closedWeekdays"));

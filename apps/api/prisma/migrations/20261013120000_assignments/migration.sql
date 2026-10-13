-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "equipment" TEXT,
ADD COLUMN     "onSiteContactName" TEXT,
ADD COLUMN     "onSiteContactPhone" TEXT,
ADD COLUMN     "serviceNotes" TEXT;

-- AlterTable
ALTER TABLE "StaffAssignment" ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "respondedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Traiteur" ADD COLUMN     "missionRedactionDays" INTEGER DEFAULT 7;



-- ─────────────── Écrit à la main : garanties portées par la base ───────────────

-- Données existantes : fin = début + 6 h si absente, réponses datées
UPDATE "StaffAssignment" SET "endAt" = "startAt" + interval '6 hours' WHERE "endAt" IS NULL;
UPDATE "StaffAssignment" SET "declineReason" = '—', "respondedAt" = "updatedAt"
  WHERE "status" = 'DECLINED' AND "declineReason" IS NULL;
UPDATE "StaffAssignment" SET "respondedAt" = "updatedAt"
  WHERE "status" IN ('CONFIRMED', 'DONE') AND "respondedAt" IS NULL;
UPDATE "StaffAssignment" SET "doneAt" = "updatedAt" WHERE "status" = 'DONE' AND "doneAt" IS NULL;

ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_dates_check"
  CHECK ("endAt" IS NOT NULL AND "endAt" > "startAt");
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_status_check" CHECK (
  ("status" <> 'DECLINED' OR "declineReason" IS NOT NULL)
  AND ("status" <> 'DONE' OR "doneAt" IS NOT NULL)
  AND ("status" = 'ASSIGNED' OR "respondedAt" IS NOT NULL)
);

ALTER TABLE "Traiteur" ADD CONSTRAINT "Traiteur_mission_redaction_check"
  CHECK ("missionRedactionDays" IS NULL OR "missionRedactionDays" BETWEEN 1 AND 365);

-- Une mission est confiée à un membre du personnel, jamais à un client
CREATE FUNCTION staff_assignment_member_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  member_role text;
BEGIN
  SELECT "role"::text INTO member_role FROM "Membership" WHERE "id" = NEW."membershipId";
  IF member_role IS NULL OR member_role NOT IN ('ADMIN_TRAITEUR', 'EMPLOYE', 'EQUIPE', 'LIVREUR') THEN
    RAISE EXCEPTION 'Affectation % : le membre doit faire partie du personnel', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "StaffAssignment_member_check"
  BEFORE INSERT OR UPDATE OF "membershipId" ON "StaffAssignment"
  FOR EACH ROW EXECUTE FUNCTION staff_assignment_member_check();

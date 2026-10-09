-- Clients, commandes et calendrier du back-office.
-- Écrite à la main : reprise des coordonnées existantes, contraintes et trigger hors Prisma.

-- ─── Coordonnées du client propres au traiteur (jamais partagées entre traiteurs) ───
ALTER TABLE "Membership"
  ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "email" TEXT,
  ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'fr';

-- Les appartenances existantes reprennent les informations du compte
UPDATE "Membership" m
SET "firstName" = u."firstName", "lastName" = u."lastName", "email" = u."email", "locale" = u."locale"
FROM "User" u
WHERE u."id" = m."userId";

ALTER TABLE "Membership" ALTER COLUMN "firstName" DROP DEFAULT, ALTER COLUMN "lastName" DROP DEFAULT;

-- ─── Commande : verrouillage optimiste ───
ALTER TABLE "Order" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Toute écriture sur la commande (en-tête, totaux recalculés par DocumentLinesService,
-- changement de statut) incrémente la version : garanti par la base, pas seulement par l'API.
CREATE FUNCTION order_bump_version() RETURNS trigger AS $$
BEGIN
  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_bump_version"
  BEFORE UPDATE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION order_bump_version();

-- La fin d'un événement suit son début (elle peut tomber le lendemain)
ALTER TABLE "Order" ADD CONSTRAINT "Order_event_end_check"
  CHECK ("eventEndDate" IS NULL OR "eventEndDate" > "eventDate");

-- ─── Lignes « par personne » ───
ALTER TABLE "OrderItem" ADD COLUMN "perPerson" BOOLEAN NOT NULL DEFAULT false;

UPDATE "OrderItem" i SET "perPerson" = true
WHERE i."itemType" = 'PACKAGE'
   OR (i."itemType" = 'DISH' AND EXISTS (
        SELECT 1 FROM "Dish" d WHERE d."id" = i."dishId" AND d."unit" = 'PER_PERSON'))
   OR (i."itemType" = 'EXTRA_SERVICE' AND EXISTS (
        SELECT 1 FROM "ExtraService" s WHERE s."id" = i."extraServiceId" AND s."pricingUnit" = 'PER_PERSON'));

-- ─── Historique des statuts ───
CREATE TABLE "OrderStatusChange" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "reason" TEXT,
    "availabilityForced" BOOLEAN NOT NULL DEFAULT false,
    "actorUserId" UUID,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderStatusChange_traiteurId_orderId_createdAt_idx" ON "OrderStatusChange"("traiteurId", "orderId", "createdAt");

ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Clé composite : un historique ne peut référencer qu'une commande du même traiteur
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_orderId_traiteurId_fkey" FOREIGN KEY ("orderId", "traiteurId") REFERENCES "Order"("id", "traiteurId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un motif est obligatoire pour une annulation
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_cancel_reason_check"
  CHECK ("toStatus" <> 'CANCELLED' OR length(btrim(coalesce("reason", ''))) > 0);

-- ─── Permissions : renommage (les surcharges des traiteurs sont conservées) ───
UPDATE "Permission" SET "key" = 'orders.write', "updatedAt" = now() WHERE "key" = 'orders.manage';
UPDATE "Permission" SET "key" = 'clients.write', "updatedAt" = now() WHERE "key" = 'clients.manage';

-- Nouvelle permission et nouveaux droits par défaut, sans attendre le seed (production)
INSERT INTO "Permission" ("id", "key", "module", "description", "isTenantEditable", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'orders.edit_confirmed', 'orders',
       'Modifier une commande confirmée (date, invités, lignes), avec motif', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "key" = 'orders.edit_confirmed');

INSERT INTO "RolePermission" ("id", "traiteurId", "role", "permissionId", "granted", "createdAt", "updatedAt")
SELECT gen_random_uuid(), NULL, grant_role::"Role", p."id", true, now(), now()
FROM (VALUES ('ADMIN_TRAITEUR', 'orders.edit_confirmed'), ('EMPLOYE', 'clients.write')) AS g(grant_role, grant_key)
JOIN "Permission" p ON p."key" = g.grant_key
WHERE NOT EXISTS (
  SELECT 1 FROM "RolePermission" rp
  WHERE rp."traiteurId" IS NULL AND rp."role" = grant_role::"Role" AND rp."permissionId" = p."id"
);

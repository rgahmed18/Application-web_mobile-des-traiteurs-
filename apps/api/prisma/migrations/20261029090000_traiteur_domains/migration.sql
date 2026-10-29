-- Domaines personnalisés des traiteurs (offre Premium) : servis seulement une fois vérifiés
-- CreateTable
CREATE TABLE "TraiteurDomain" (
    "id" UUID NOT NULL,
    "traiteurId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraiteurDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TraiteurDomain_hostname_key" ON "TraiteurDomain"("hostname");

-- CreateIndex
CREATE INDEX "TraiteurDomain_traiteurId_idx" ON "TraiteurDomain"("traiteurId");

-- AddForeignKey
ALTER TABLE "TraiteurDomain" ADD CONSTRAINT "TraiteurDomain_traiteurId_fkey" FOREIGN KEY ("traiteurId") REFERENCES "Traiteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "TraiteurDomain" ADD CONSTRAINT "TraiteurDomain_status_check"
  CHECK ("status" IN ('PENDING', 'ACTIVE', 'DISABLED'));

-- Nom d'hôte normalisé (minuscules, sans port ni point final)
ALTER TABLE "TraiteurDomain" ADD CONSTRAINT "TraiteurDomain_hostname_check"
  CHECK ("hostname" = lower("hostname") AND "hostname" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');

-- Actif : forcément vérifié
ALTER TABLE "TraiteurDomain" ADD CONSTRAINT "TraiteurDomain_active_verified"
  CHECK ("status" <> 'ACTIVE' OR "verifiedAt" IS NOT NULL);

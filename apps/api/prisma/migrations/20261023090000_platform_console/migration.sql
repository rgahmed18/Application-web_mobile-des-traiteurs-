-- Console de la plateforme : fin de période d'essai des traiteurs, prix des offres (historique).
-- AlterTable
ALTER TABLE "Traiteur" ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlatformPlanPrice" (
    "id" UUID NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "monthlyPrice" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPlanPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformPlanPrice_plan_effectiveFrom_idx" ON "PlatformPlanPrice"("plan", "effectiveFrom");


ALTER TABLE "PlatformPlanPrice" ADD CONSTRAINT "PlatformPlanPrice_price_check"
  CHECK ("monthlyPrice" >= 0 AND "monthlyPrice" <= 100000000);

-- Traiteurs déjà en essai : 30 jours à compter de leur création
UPDATE "Traiteur" SET "trialEndsAt" = "createdAt" + INTERVAL '30 days'
WHERE "status" = 'TRIAL' AND "trialEndsAt" IS NULL;

-- Prix de départ (MAD par mois), modifiables dans la console
INSERT INTO "PlatformPlanPrice" ("id", "plan", "monthlyPrice", "effectiveFrom") VALUES
  (gen_random_uuid(), 'BASIQUE', 40000, TIMESTAMP '2026-01-01 00:00:00'),
  (gen_random_uuid(), 'PRO', 85000, TIMESTAMP '2026-01-01 00:00:00'),
  (gen_random_uuid(), 'PREMIUM', 150000, TIMESTAMP '2026-01-01 00:00:00');

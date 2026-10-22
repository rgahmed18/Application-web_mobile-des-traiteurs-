-- Activation des comptes de la plateforme (SUPER_ADMIN) créés par la commande super-admin.
-- CreateTable
CREATE TABLE "AccountActivation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountActivation_tokenHash_key" ON "AccountActivation"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountActivation_userId_idx" ON "AccountActivation"("userId");

-- AddForeignKey
ALTER TABLE "AccountActivation" ADD CONSTRAINT "AccountActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Matrice des permissions par défaut modifiable dans la console : cases modifiées conservées au déploiement
-- AlterTable
ALTER TABLE "RolePermission" ADD COLUMN     "editedAt" TIMESTAMP(3);


-- Seule la matrice par défaut (traiteurId NULL) est modifiée dans la console
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_edited_default_only"
  CHECK ("editedAt" IS NULL OR "traiteurId" IS NULL);

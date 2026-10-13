-- Nouveau rôle : personnel de terrain (cuisine, service, extras), qui ne voit que ses missions.
-- Migration séparée : une valeur d'enum ajoutée ne peut pas servir dans la même transaction.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'EQUIPE' BEFORE 'LIVREUR';

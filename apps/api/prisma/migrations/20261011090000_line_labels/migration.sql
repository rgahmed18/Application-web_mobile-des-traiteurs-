-- Libellés des lignes (commande, devis, facture) : LocalizedText { fr, ar?, en? } figé dans toutes
-- les langues au moment de l'ajout, au lieu d'une chaîne dans la langue du client.
-- Conversion en place : le libellé existant devient la version française. ALTER COLUMN … TYPE
-- réécrit la table sans déclencher les triggers d'immuabilité ; montants, numéros et PDF des
-- documents émis sont inchangés.
ALTER TABLE "OrderItem" ALTER COLUMN "label" TYPE JSONB USING jsonb_build_object('fr', "label");
ALTER TABLE "QuoteLine" ALTER COLUMN "label" TYPE JSONB USING jsonb_build_object('fr', "label");
ALTER TABLE "InvoiceLine" ALTER COLUMN "label" TYPE JSONB USING jsonb_build_object('fr', "label");

-- Toujours un objet avec un libellé français non vide (langue de repli)
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_label_check" CHECK (
  jsonb_typeof("label") = 'object' AND length(btrim(coalesce("label"->>'fr', ''))) > 0
);
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_label_check" CHECK (
  jsonb_typeof("label") = 'object' AND length(btrim(coalesce("label"->>'fr', ''))) > 0
);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_label_check" CHECK (
  jsonb_typeof("label") = 'object' AND length(btrim(coalesce("label"->>'fr', ''))) > 0
);

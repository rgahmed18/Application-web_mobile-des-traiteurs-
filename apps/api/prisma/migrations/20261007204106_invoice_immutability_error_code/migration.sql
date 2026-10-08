-- Les erreurs d'immuabilité des factures utilisaient SQLSTATE 23001 (restrict_violation),
-- que Prisma traduit en « Foreign key constraint violated » en perdant le message.
-- On utilise désormais le code par défaut de RAISE (P0001), transmis tel quel aux clients.

CREATE OR REPLACE FUNCTION invoice_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Facture % immuable : suppression interdite', OLD."id";
  END IF;
  IF (to_jsonb(NEW) - 'pdfUrl' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'pdfUrl' - 'updatedAt') THEN
    RAISE EXCEPTION 'Facture % immuable : toute correction passe par un avoir', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION invoice_line_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ligne de facture % immuable', OLD."id";
END;
$$;

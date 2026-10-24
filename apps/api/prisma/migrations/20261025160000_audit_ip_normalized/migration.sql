-- Journal d'audit : adresses IPv4 vues à travers une socket IPv6 (« ::ffff:192.168.43.120 »)
-- ramenées à leur forme courte (« 192.168.43.120 »), comme les nouvelles entrées.
UPDATE "AuditLog"
SET "ipAddress" = substring("ipAddress" FROM 8)
WHERE "ipAddress" ~* '^::ffff:[0-9]{1,3}(\.[0-9]{1,3}){3}$';

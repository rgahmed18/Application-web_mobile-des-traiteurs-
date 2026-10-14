#!/usr/bin/env bash
# Test RÉEL, de bout en bout, des scripts de sauvegarde et de restauration du serveur, dans des
# conteneurs jetables (rien n'est installé sur la machine, aucune image de l'application n'est
# construite) :
#   - PostgreSQL 17 (données : fixture, ou un pg_dump -Fc passé en argument) ;
#   - stockage S3 (RustFS) à la place de Cloudflare R2 ;
#   - Ubuntu 24.04 (comme le serveur, mêmes paquets age, rclone, jq) qui exécute backup.sh,
#     restore.sh et verify-backup.sh tels quels.
# Vérifie : sauvegarde chiffrée envoyée ; restauration de test avec la clé machine ET avec la
# clé de secours ; refus d'une mauvaise clé ; restauration réelle après perte de données, avec
# des données identiques à l'octet près ; vérification hebdomadaire.
#
#   deploy/tests/backup-restore.sh                 données de test intégrées
#   deploy/tests/backup-restore.sh base.dump       données réelles (pg_dump -Fc)
set -euo pipefail
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS_HOST="$(cd "$HERE/../scripts" && (pwd -W 2>/dev/null || pwd))"
DUMP="${1:-}"
ID="$$"
NET="traiteur-test-$ID"
PG="traiteur-test-pg-$ID"
S3="traiteur-test-s3-$ID"

cleanup() {
  docker rm -f "$PG" "$S3" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

step "Conteneurs jetables (PostgreSQL, stockage S3)"
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_USER=traiteur \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=traiteur postgres:17-alpine >/dev/null
docker run -d --name "$S3" --network "$NET" --network-alias stockage \
  -e RUSTFS_ACCESS_KEY=test -e RUSTFS_SECRET_KEY=test-secret rustfs/rustfs:1.0.1 >/dev/null
# Prêt en TCP seulement (le serveur temporaire d'initialisation n'écoute que sur le socket)
for _ in $(seq 1 90); do docker exec "$PG" pg_isready -h 127.0.0.1 -U traiteur -d traiteur >/dev/null 2>&1 && break; sleep 1; done

step "Données de départ"
if [ -n "$DUMP" ]; then
  docker exec -i "$PG" pg_restore -U traiteur -d traiteur --no-owner < "$DUMP"
else
  docker exec -i "$PG" psql -q -U traiteur -d traiteur -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE _prisma_migrations (id text PRIMARY KEY, migration_name text, finished_at timestamptz);
CREATE TABLE "Traiteur" (id serial PRIMARY KEY, name text);
CREATE TABLE "Order" (id serial PRIMARY KEY, reference text, total_ttc int);
CREATE TABLE "Invoice" (id serial PRIMARY KEY, number text);
CREATE TABLE "Payment" (id serial PRIMARY KEY, amount int, note text);
INSERT INTO _prisma_migrations SELECT 'm' || i, 'migration_' || i, now() FROM generate_series(1, 15) i;
INSERT INTO "Traiteur" (name) VALUES ('Dar Diafa'), ('Traiteur fictif');
INSERT INTO "Order" (reference, total_ttc) SELECT 'CMD-2026-' || lpad(i::text, 5, '0'), i * 1000 FROM generate_series(1, 500) i;
INSERT INTO "Invoice" (number) SELECT 'FAC-2026-' || lpad(i::text, 5, '0') FROM generate_series(1, 200) i;
INSERT INTO "Payment" (amount, note) SELECT i * 100, 'Paiement fictif « été » n°' || i FROM generate_series(1, 300) i;
SQL
fi
# Empreinte de toutes les données (tables métier) : comparée après la restauration réelle
fingerprint() {
  docker exec "$PG" psql -U traiteur -d traiteur -tA -c "
    SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
      SELECT 'p' || md5(string_agg(p::text, ',' ORDER BY p::text)) AS t FROM \"Payment\" p
      UNION ALL SELECT 'o' || md5(string_agg(o::text, ',' ORDER BY o::text)) FROM \"Order\" o
      UNION ALL SELECT 'i' || md5(string_agg(i::text, ',' ORDER BY i::text)) FROM \"Invoice\" i
      UNION ALL SELECT 't' || md5(string_agg(r::text, ',' ORDER BY r::text)) FROM \"Traiteur\" r
    ) parts;"
}
ORIGINAL="$(fingerprint)"
echo "Empreinte des données : $ORIGINAL"

step "Scripts du serveur dans Ubuntu 24.04"
docker run --rm -i --network "$NET" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$SCRIPTS_HOST:/src:ro" \
  -e POSTGRES_CONTAINER="$PG" -e ORIGINAL="$ORIGINAL" \
  ubuntu:24.04 bash -s <<'TEST'
set -euo pipefail
step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq age rclone jq curl docker.io >/dev/null 2>&1

ROOT=/opt/traiteur
export RCLONE_CONFIG=/dev/null
mkdir -p "$ROOT/scripts" "$ROOT/secrets" /secours
cp /src/*.sh "$ROOT/scripts/"
chmod +x "$ROOT/scripts/"*.sh
# Docker Compose n'existe pas ici : arrêt et redémarrage des services simulés
printf '#!/bin/sh\necho "(compose simulé) $*"\n' > "$ROOT/scripts/compose.sh"
chmod +x "$ROOT/scripts/compose.sh"

# Clé de SECOURS (en vrai : générée sur votre ordinateur, jamais sur le serveur) et clé MACHINE
age-keygen -o /secours/secours.key 2>/dev/null
age-keygen -o "$ROOT/secrets/backup-machine.key" 2>/dev/null
SECOURS_PUB="$(age-keygen -y /secours/secours.key)"
MACHINE_PUB="$(age-keygen -y "$ROOT/secrets/backup-machine.key")"
cat > "$ROOT/.env" <<ENV
ENVIRONMENT=test
S3_ENDPOINT=http://stockage:9000
BACKUP_S3_BUCKET=sauvegardes
BACKUP_S3_ACCESS_KEY_ID=test
BACKUP_S3_SECRET_ACCESS_KEY=test-secret
BACKUP_AGE_RECIPIENTS=$SECOURS_PUB $MACHINE_PUB
BACKUP_AGE_MACHINE_KEY=$ROOT/secrets/backup-machine.key
HEALTHCHECK_BACKUP_URL=
HEALTHCHECK_VERIFY_URL=
ROBOTS=noindex, nofollow
ENV
export BACKUP_S3_PROVIDER=Other BACKUP_S3_REGION=us-east-1
for _ in $(seq 1 30); do curl -s -o /dev/null http://stockage:9000 && break; sleep 1; done
RCLONE_CONFIG_T_TYPE=s3 RCLONE_CONFIG_T_PROVIDER=Other RCLONE_CONFIG_T_ENDPOINT=http://stockage:9000 \
  RCLONE_CONFIG_T_ACCESS_KEY_ID=test RCLONE_CONFIG_T_SECRET_ACCESS_KEY=test-secret rclone mkdir t:sauvegardes

step "1. Sauvegarde chiffrée"
"$ROOT/scripts/backup.sh"
"$ROOT/scripts/restore.sh" --list
FILE="$("$ROOT/scripts/restore.sh" --list | awk '{print $NF}' | tail -n 1)"
RCLONE_CONFIG_T_TYPE=s3 RCLONE_CONFIG_T_PROVIDER=Other RCLONE_CONFIG_T_ENDPOINT=http://stockage:9000 \
  RCLONE_CONFIG_T_ACCESS_KEY_ID=test RCLONE_CONFIG_T_SECRET_ACCESS_KEY=test-secret \
  rclone cat "t:sauvegardes/test/$FILE" | head -c 64 | grep -q 'age-encryption.org' \
  && echo "✓ Fichier chiffré (en-tête age), illisible sans clé"

step "2. Restauration de test avec la clé MACHINE"
"$ROOT/scripts/restore.sh"

step "3. Restauration de test avec la clé de SECOURS (serveur perdu)"
"$ROOT/scripts/restore.sh" --identity /secours/secours.key

step "4. Une mauvaise clé est refusée"
age-keygen -o /tmp/autre.key 2>/dev/null
if "$ROOT/scripts/restore.sh" --identity /tmp/autre.key 2>/dev/null; then
  echo "✗ Une clé étrangère a déchiffré la sauvegarde"; exit 1
fi
echo "✓ Clé étrangère refusée"

step "5. Base détruite (rançongiciel, erreur de manipulation), puis restauration RÉELLE"
docker exec "$POSTGRES_CONTAINER" psql -q -U traiteur -d traiteur   -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
echo test | "$ROOT/scripts/restore.sh" --live latest
AFTER="$(docker exec "$POSTGRES_CONTAINER" psql -U traiteur -d traiteur -tA -c "
    SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
      SELECT 'p' || md5(string_agg(p::text, ',' ORDER BY p::text)) AS t FROM \"Payment\" p
      UNION ALL SELECT 'o' || md5(string_agg(o::text, ',' ORDER BY o::text)) FROM \"Order\" o
      UNION ALL SELECT 'i' || md5(string_agg(i::text, ',' ORDER BY i::text)) FROM \"Invoice\" i
      UNION ALL SELECT 't' || md5(string_agg(r::text, ',' ORDER BY r::text)) FROM \"Traiteur\" r
    ) parts;")"
[ "$AFTER" = "$ORIGINAL" ] || { echo "✗ Données restaurées différentes ($AFTER ≠ $ORIGINAL)"; exit 1; }
echo "✓ Données restaurées identiques à l'original ($AFTER)"

step "6. Vérification hebdomadaire (verify-backup.sh)"
"$ROOT/scripts/verify-backup.sh"
echo
echo "✓ TOUS LES TESTS DE SAUVEGARDE ET DE RESTAURATION ONT RÉUSSI"
TEST

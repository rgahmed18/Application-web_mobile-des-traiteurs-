#!/usr/bin/env bash
# Sauvegarde de PostgreSQL : pg_dump (format compressé), chiffrée avec age pour la clé de
# secours ET la clé machine, puis envoyée dans le bucket R2 des sauvegardes.
#
# Protection contre un serveur piraté ou un rançongiciel : ce script ne supprime ni n'écrase
# JAMAIS rien (nom unique par sauvegarde). Le bucket est verrouillé (« bucket lock » R2 :
# suppression et écrasement impossibles pendant 30 jours, même avec le jeton du serveur), et
# seule la règle de cycle de vie du bucket supprime les sauvegardes, au 31e jour.
# Vérification du verrou : check-backup-lock.sh.
#   ./backup.sh                  sauvegarde quotidienne (minuteur systemd, 02:30)
#   ./backup.sh avant-v1.2.0     étiquette libre (deploy.sh, avant chaque migration)
set -euo pipefail
. "$(dirname "$0")/lib.sh"

LABEL="${1:-quotidienne}"
[[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || fail "Étiquette invalide : $LABEL"
HEALTHCHECK_URL="$(env_get HEALTHCHECK_BACKUP_URL)"
[ "$LABEL" = quotidienne ] || HEALTHCHECK_URL=""
trap 'ping_healthcheck "$HEALTHCHECK_URL" /fail' ERR
ping_healthcheck "$HEALTHCHECK_URL" /start

use_backup_storage
read -r -a RECIPIENTS <<< "$(env_get BACKUP_AGE_RECIPIENTS)"
[ "${#RECIPIENTS[@]}" -ge 1 ] || fail "BACKUP_AGE_RECIPIENTS vide : aucune clé de chiffrement"
AGE_ARGS=()
for recipient in "${RECIPIENTS[@]}"; do
  [[ "$recipient" =~ ^age1[0-9a-z]+$ ]] || fail "Clé publique age invalide : $recipient"
  AGE_ARGS+=(-r "$recipient")
done

ENVIRONMENT="$(env_get ENVIRONMENT)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="$(date -u +%Y/%m)/traiteur-$ENVIRONMENT-$STAMP-$LABEL.dump.age"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FILE="$WORK/backup.dump.age"

log "Sauvegarde de la base ($ENVIRONMENT, $LABEL)…"
# pipefail : un échec de pg_dump fait échouer la sauvegarde (jamais de fichier tronqué envoyé)
docker exec "$POSTGRES_CONTAINER" pg_dump -U traiteur -d traiteur -Fc --no-owner \
  | age "${AGE_ARGS[@]}" -o "$FILE"
SIZE="$(stat -c %s "$FILE")"
[ "$SIZE" -gt 1024 ] || fail "Sauvegarde anormalement petite ($SIZE octets)"

log "Envoi vers $BACKUP_PREFIX/$NAME ($((SIZE / 1024)) Ko)…"
# --immutable : refuse d'écraser un objet existant (en plus du verrou du bucket)
rclone copyto --immutable --s3-no-check-bucket "$FILE" "$BACKUP_PREFIX/$NAME"
REMOTE_SIZE="$(rclone lsjson "$BACKUP_PREFIX/$NAME" | jq '.[0].Size')"
[ "$REMOTE_SIZE" = "$SIZE" ] || fail "Taille envoyée différente ($REMOTE_SIZE au lieu de $SIZE)"

ping_healthcheck "$HEALTHCHECK_URL"
log "✓ Sauvegarde terminée : $NAME"

#!/usr/bin/env bash
# Restauration d'une sauvegarde.
#
#   ./restore.sh                         TEST : dernière sauvegarde restaurée dans une base
#                                        jetable (conteneur temporaire), contrôles, puis supprimée
#   ./restore.sh --list                  liste des sauvegardes disponibles
#   ./restore.sh 2026/10/traiteur-production-20261014T013000Z-quotidienne.dump.age
#                                        TEST d'une sauvegarde précise
#   ./restore.sh --live <fichier|latest> RESTAURATION RÉELLE dans la base de ce serveur
#                                        (confirmation demandée, sauvegarde de sécurité avant)
#   --identity <fichier>                 clé privée age à utiliser (par défaut : clé machine ;
#                                        clé de SECOURS sur un nouveau serveur)
#   --file <chemin local>                sauvegarde déjà téléchargée (sans R2)
set -euo pipefail
. "$(dirname "$0")/lib.sh"

MODE="test"
TARGET=latest
IDENTITY=""
LOCAL_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --live) MODE=live ;;
    --list) MODE=list ;;
    --identity) IDENTITY="${2:?}"; shift ;;
    --file) LOCAL_FILE="${2:?}"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) TARGET="$1" ;;
  esac
  shift
done
IDENTITY="${IDENTITY:-$(env_get BACKUP_AGE_MACHINE_KEY)}"

if [ -z "$LOCAL_FILE" ]; then
  use_backup_storage
fi

if [ "$MODE" = list ]; then
  rclone lsl "$BACKUP_PREFIX" | sort -k2,3
  exit 0
fi

[ -r "$IDENTITY" ] || fail "Clé privée illisible : $IDENTITY (--identity <fichier>)"

WORK="$(mktemp -d)"
CHECK_CONTAINER="traiteur-restore-check-$$"
cleanup() {
  docker rm -f "$CHECK_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
DUMP="$WORK/backup.dump"

if [ -n "$LOCAL_FILE" ]; then
  SOURCE="$LOCAL_FILE"
else
  if [ "$TARGET" = latest ]; then
    # Dernière sauvegarde, hors sauvegardes de sécurité prises juste avant une restauration
    # (elles reflètent une base possiblement détruite ; accessibles par leur nom)
    TARGET="$(rclone lsf --recursive --files-only "$BACKUP_PREFIX" | grep '\.dump\.age$'       | grep -v -- '-avant-restauration\.dump\.age$' | sort | tail -n 1)"
    [ -n "$TARGET" ] || fail "Aucune sauvegarde dans $BACKUP_PREFIX"
  fi
  log "Téléchargement de $TARGET…"
  rclone copyto "$BACKUP_PREFIX/$TARGET" "$WORK/backup.dump.age"
  SOURCE="$WORK/backup.dump.age"
fi

log "Déchiffrement…"
age -d -i "$IDENTITY" -o "$DUMP" "$SOURCE"

# Contrôles : migrations appliquées, tables principales lisibles
summary() {
  local container="$1" user="$2"
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U "$user" -d traiteur -tA -F ' ' -c "
    SELECT
      (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) AS migrations,
      (SELECT count(*) FROM \"Traiteur\") AS traiteurs,
      (SELECT count(*) FROM \"Order\") AS commandes,
      (SELECT count(*) FROM \"Invoice\") AS factures,
      (SELECT count(*) FROM \"Payment\") AS paiements;"
}

if [ "$MODE" = test ]; then
  log "Restauration dans une base jetable (conteneur isolé, sans réseau)…"
  docker run -d --rm --name "$CHECK_CONTAINER" --network none \
    -e POSTGRES_PASSWORD=verification -e POSTGRES_DB=traiteur postgres:17-alpine >/dev/null
  # Prêt seulement en TCP : pendant l'initialisation, l'image démarre un serveur temporaire
  # (socket local uniquement) puis l'arrête ; restaurer à ce moment-là échouerait
  READY=0
  for _ in $(seq 1 90); do
    if docker exec "$CHECK_CONTAINER" pg_isready -h 127.0.0.1 -U postgres -d traiteur >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 1
  done
  [ "$READY" -eq 1 ] || fail "La base jetable n'a pas démarré"

  docker exec -i "$CHECK_CONTAINER" pg_restore -U postgres -d traiteur --no-owner --exit-on-error < "$DUMP"
  SUMMARY="$(summary "$CHECK_CONTAINER" postgres 2>/dev/null)"     || fail "Sauvegarde inutilisable : aucune base de l'application dedans (tables absentes)"
  read -r MIGRATIONS TRAITEURS ORDERS INVOICES PAYMENTS <<< "$SUMMARY"
  log "Sauvegarde restaurée : $MIGRATIONS migrations, $TRAITEURS traiteur(s), $ORDERS commande(s), $INVOICES facture(s), $PAYMENTS paiement(s)"
  if docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
    LIVE_MIGRATIONS="$(summary "$POSTGRES_CONTAINER" traiteur | cut -d' ' -f1)"
    [ "$MIGRATIONS" -le "$LIVE_MIGRATIONS" ] || fail "Plus de migrations dans la sauvegarde ($MIGRATIONS) que dans la base ($LIVE_MIGRATIONS)"
    log "Base actuelle : $LIVE_MIGRATIONS migrations"
  fi
  [ "$MIGRATIONS" -gt 0 ] || fail "Aucune migration dans la sauvegarde : fichier inutilisable"
  log "✓ Test de restauration réussi"
  exit 0
fi

# ── Restauration réelle ──
ENVIRONMENT="$(env_get ENVIRONMENT)"
log "ATTENTION : la base « $ENVIRONMENT » de ce serveur va être REMPLACÉE par $TARGET."
read -r -p "Tapez le nom de l'environnement ($ENVIRONMENT) pour confirmer : " CONFIRM
[ "$CONFIRM" = "$ENVIRONMENT" ] || fail "Confirmation incorrecte, rien n'a été modifié."

log "Sauvegarde de sécurité de la base actuelle…"
"$(dirname "$0")/backup.sh" avant-restauration || log "Sauvegarde de sécurité impossible (base vide ?)"

log "Arrêt de l'API, du worker et du back-office…"
"$(dirname "$0")/compose.sh" stop api worker web
log "Restauration…"
docker exec "$POSTGRES_CONTAINER" psql -U traiteur -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS traiteur WITH (FORCE);' -c 'CREATE DATABASE traiteur OWNER traiteur;'
docker exec -i "$POSTGRES_CONTAINER" pg_restore -U traiteur -d traiteur --no-owner --exit-on-error < "$DUMP"
read -r MIGRATIONS TRAITEURS ORDERS INVOICES PAYMENTS <<< "$(summary "$POSTGRES_CONTAINER" traiteur)"
log "Base restaurée : $MIGRATIONS migrations, $TRAITEURS traiteur(s), $ORDERS commande(s), $INVOICES facture(s), $PAYMENTS paiement(s)"
log "Redémarrage…"
"$(dirname "$0")/compose.sh" up -d
log "✓ Restauration terminée. Vérifiez le back-office, puis redéployez la version correspondant à la sauvegarde si besoin."

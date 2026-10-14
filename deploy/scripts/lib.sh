#!/usr/bin/env bash
# Fonctions communes des scripts serveur (sourcé, jamais exécuté seul).
ROOT="${TRAITEUR_ROOT:-/opt/traiteur}"
ENV_FILE="${TRAITEUR_ENV_FILE:-$ROOT/.env}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-traiteur-postgres-1}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
fail() { log "ERREUR : $*"; exit 1; }

# Valeur d'une variable du .env (sans l'exécuter : les valeurs peuvent contenir des espaces)
env_get() {
  local value
  value="$(sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1)"
  value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

# rclone configuré par variables d'environnement (aucun fichier de configuration à protéger)
use_backup_storage() {
  # Aucun fichier de configuration rclone : tout passe par ces variables
  export RCLONE_CONFIG=/dev/null
  export RCLONE_CONFIG_BACKUP_TYPE=s3
  export RCLONE_CONFIG_BACKUP_PROVIDER="${BACKUP_S3_PROVIDER:-Cloudflare}"
  RCLONE_CONFIG_BACKUP_ENDPOINT="${BACKUP_S3_ENDPOINT:-$(env_get S3_ENDPOINT)}"
  RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$(env_get BACKUP_S3_ACCESS_KEY_ID)"
  RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$(env_get BACKUP_S3_SECRET_ACCESS_KEY)"
  export RCLONE_CONFIG_BACKUP_ENDPOINT RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY
  # Jeton limité aux objets du bucket : ne pas tenter de le créer
  export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_BACKUP_REGION="${BACKUP_S3_REGION:-auto}"
  BACKUP_BUCKET="$(env_get BACKUP_S3_BUCKET)"
  # Utilisé par les scripts qui sourcent ce fichier
  # shellcheck disable=SC2034
  BACKUP_PREFIX="backup:$BACKUP_BUCKET/$(env_get ENVIRONMENT)"
  [ -n "$BACKUP_BUCKET" ] || fail "BACKUP_S3_BUCKET manquant dans $ENV_FILE"
}

# Signalement à healthchecks.io (succès, début, échec) ; silencieux si non configuré
ping_healthcheck() {
  local url="$1" suffix="${2:-}"
  [ -n "$url" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$url$suffix" || log "Signalement $url$suffix impossible"
}

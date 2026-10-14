#!/usr/bin/env bash
# Déploie une version (étiquette d'image) sur ce serveur :
#   1. télécharge les images ;  2. sauvegarde la base (avant migration) ;
#   3. applique les migrations et la matrice des permissions ;  4. redémarre les services ;
#   5. vérifie la santé de l'API et du back-office ; en cas d'échec, revient à la version
#      précédente (les migrations déjà appliquées restent : voir « Retour en arrière » dans
#      docs/deploiement.md).
#
#   ./deploy.sh sha-1a2b3c4      (staging, lancé par GitHub Actions)
#   ./deploy.sh v1.0.0           (production)
set -euo pipefail
ROOT="${TRAITEUR_ROOT:-/opt/traiteur}"
SCRIPTS="$ROOT/scripts"
TAG="${1:?Usage : deploy.sh <étiquette de l’image>}"
cd "$ROOT"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
current_tag() { sed -n 's/^IMAGE_TAG=//p' .image.env 2>/dev/null || true; }

# Un seul déploiement à la fois
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { log "Un déploiement est déjà en cours."; exit 1; }

PREVIOUS="$(current_tag)"
log "Déploiement de $TAG (version actuelle : ${PREVIOUS:-aucune})"

compose_tag() { local tag="$1"; shift; IMAGE_TAG="$tag" "$SCRIPTS/compose.sh" "$@"; }

wait_healthy() {
  local deadline=$((SECONDS + 180)) service status
  for service in api web; do
    while :; do
      status="$(docker inspect --format '{{.State.Health.Status}}' "traiteur-$service-1" 2>/dev/null || echo absent)"
      [ "$status" = healthy ] && break
      if [ "$SECONDS" -ge "$deadline" ]; then
        log "Service $service non opérationnel (état : $status)"
        return 1
      fi
      sleep 3
    done
    log "Service $service opérationnel"
  done
}

log "Téléchargement des images…"
compose_tag "$TAG" pull api worker web migrate

log "Démarrage de la base et de Redis…"
compose_tag "${PREVIOUS:-$TAG}" up -d postgres redis

if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != none ]; then
  log "Sauvegarde avant migration…"
  "$SCRIPTS/backup.sh" "avant-$TAG"
fi

log "Migrations et permissions…"
compose_tag "$TAG" run --rm migrate

log "Redémarrage des services…"
compose_tag "$TAG" up -d --remove-orphans
# Caddyfile éventuellement modifié par la nouvelle version : rechargé sans coupure
compose_tag "$TAG" exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true

if wait_healthy; then
  printf 'IMAGE_TAG=%s\n' "$TAG" > .image.env
  printf '%s %s (précédente : %s)\n' "$(date -Iseconds)" "$TAG" "${PREVIOUS:-aucune}" >> deploy-history.log
  docker image prune -f --filter "until=168h" >/dev/null || true
  log "✓ $TAG déployée"
  exit 0
fi

log "✗ Échec : retour à la version précédente ${PREVIOUS:-(aucune)}"
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != none ]; then
  compose_tag "$PREVIOUS" up -d --remove-orphans
  wait_healthy || log "La version précédente ne répond pas non plus : voir ./compose.sh logs"
fi
printf '%s ÉCHEC %s (retour à %s)\n' "$(date -Iseconds)" "$TAG" "${PREVIOUS:-aucune}" >> deploy-history.log
exit 1

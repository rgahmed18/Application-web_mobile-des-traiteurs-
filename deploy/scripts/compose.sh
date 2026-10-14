#!/usr/bin/env bash
# Docker Compose de l'environnement, avec sa configuration (.env) et la version déployée
# (.image.env, écrit par deploy.sh). Exemples :
#   ./compose.sh ps                 état des services
#   ./compose.sh logs -f --tail 100 api
#   ./compose.sh restart web
set -euo pipefail
ROOT="${TRAITEUR_ROOT:-/opt/traiteur}"
cd "$ROOT"
[ -f .image.env ] || echo "IMAGE_TAG=none" > .image.env
exec docker compose --project-directory "$ROOT" --env-file .env --env-file .image.env \
  -f docker-compose.prod.yml "$@"

#!/usr/bin/env bash
# Commande FORCÉE de la clé SSH de GitHub Actions (authorized_keys : command="…ci-deploy.sh") :
# cette clé ne peut QUE déployer une version (sha-<commit> ou vX.Y.Z), jamais ouvrir un
# terminal ni lire la configuration. Les scripts et fichiers de déploiement sont extraits de
# l'image de la version déployée : ils restent synchronisés avec le code, même pour un retour
# en arrière.
set -euo pipefail
ROOT="${TRAITEUR_ROOT:-/opt/traiteur}"
REQUEST="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$REQUEST" =~ ^deploy\ (sha-[0-9a-f]{7,40}|v[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "Commande refusée : « $REQUEST » (attendu : deploy sha-xxxxxxx ou deploy v1.2.3)" >&2
  exit 1
fi
TAG="${BASH_REMATCH[1]}"
REGISTRY="$(sed -n 's/^IMAGE_REGISTRY=//p' "$ROOT/.env" | tail -n 1)"
IMAGE="$REGISTRY/traiteur-api:$TAG"

docker pull --quiet "$IMAGE" >/dev/null
CID="$(docker create "$IMAGE")"
RELEASE="$(mktemp -d)"
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true; rm -rf "$RELEASE"' EXIT
docker cp "$CID:/app/deploy/." "$RELEASE/"

install -m 0644 "$RELEASE/docker-compose.prod.yml" "$ROOT/docker-compose.prod.yml"
# Caddyfile monté dans le conteneur : réécrit en place (même fichier), puis rechargé
cat "$RELEASE/Caddyfile" > "$ROOT/Caddyfile"
for script in "$RELEASE"/scripts/*.sh; do
  install -m 0755 "$script" "$ROOT/scripts/$(basename "$script")"
done
exec "$ROOT/scripts/deploy.sh" "$TAG"

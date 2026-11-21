#!/usr/bin/env bash
# Connexion du serveur au registre d'images privé (GitHub Container Registry), à lancer une
# fois par serveur, en tant que deploy, puis à chaque renouvellement du jeton :
#
#   /opt/traiteur/scripts/ghcr-login.sh VOTRE_COMPTE
#
# Le jeton (classique, UNE seule permission : read:packages) est demandé sans écho : il
# n'apparaît ni à l'écran, ni dans l'historique du shell, ni dans la liste des processus. Il
# n'est stocké QUE sur ce serveur (~/.docker/config.json, lisible par deploy seul), jamais
# dans le dépôt, le .env ou GitHub Actions. Une image privée de test est ensuite téléchargée
# pour vérifier l'accès.
set -euo pipefail
ROOT="${TRAITEUR_ROOT:-/opt/traiteur}"
USER_NAME="${1:?Usage : ghcr-login.sh <compte GitHub>}"

read -r -s -p "Jeton GHCR (read:packages, rien d'autre) : " TOKEN
echo
[ -n "$TOKEN" ] || { echo "Jeton vide : abandon." >&2; exit 1; }
case "$TOKEN" in
  github_pat_*)
    echo "Jeton « fine-grained » : GHCR ne l'accepte pas pour télécharger des images." >&2
    echo "Créez un jeton classique avec la seule case read:packages (docs/deploiement.md, 7.3)." >&2
    exit 1
    ;;
esac

printf '%s' "$TOKEN" | docker login ghcr.io --username "$USER_NAME" --password-stdin
unset TOKEN
chmod 700 "$HOME/.docker"
chmod 600 "$HOME/.docker/config.json"

REGISTRY="$(sed -n 's/^IMAGE_REGISTRY=//p' "$ROOT/.env" 2>/dev/null | tail -n 1)"
TAG="$(sed -n 's/^IMAGE_TAG=//p' "$ROOT/.image.env" 2>/dev/null || true)"
if [ -n "$REGISTRY" ] && [ -n "$TAG" ] && [ "$TAG" != none ]; then
  docker pull --quiet "$REGISTRY/traiteur-api:$TAG" >/dev/null
  echo "✓ Accès vérifié : $REGISTRY/traiteur-api:$TAG"
else
  echo "✓ Connecté à ghcr.io (l'accès sera vérifié au premier déploiement)."
fi
echo "Notez la date d'expiration du jeton et renouvelez-le avant (même commande)."

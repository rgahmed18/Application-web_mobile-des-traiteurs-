#!/usr/bin/env bash
# Vérification automatique (minuteur systemd, chaque dimanche) : la dernière sauvegarde est
# téléchargée, déchiffrée avec la clé machine et restaurée dans une base jetable. Une
# sauvegarde qui n'a jamais été restaurée ne compte pas.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
URL="$(env_get HEALTHCHECK_VERIFY_URL)"
ping_healthcheck "$URL" /start
if "$(dirname "$0")/restore.sh"; then
  ping_healthcheck "$URL"
else
  ping_healthcheck "$URL" /fail
  exit 1
fi

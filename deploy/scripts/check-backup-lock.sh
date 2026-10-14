#!/usr/bin/env bash
# Vérifie que les identifiants R2 du SERVEUR ne peuvent ni supprimer ni écraser une sauvegarde
# (verrou du bucket actif). À lancer après la configuration du bucket, puis de temps en temps.
# Un petit fichier de test est déposé (préfixe verrou-test/) : il est conservé par le verrou,
# puis supprimé par la règle de cycle de vie comme les sauvegardes.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
use_backup_storage

KEY="verrou-test/$(date -u +%Y%m%dT%H%M%SZ).txt"
TARGET="backup:$BACKUP_BUCKET/$KEY"
printf 'Test du verrou des sauvegardes\n' | rclone rcat --s3-no-check-bucket "$TARGET"
log "Fichier de test déposé : $KEY"

PROTECTED=1
if rclone deletefile "$TARGET" 2>/dev/null; then
  log "✗ SUPPRESSION ACCEPTÉE : le verrou du bucket n'est pas actif."
  PROTECTED=0
else
  log "✓ Suppression refusée"
fi
if printf 'écrasement\n' | rclone rcat --s3-no-check-bucket "$TARGET" 2>/dev/null; then
  log "✗ ÉCRASEMENT ACCEPTÉ : le verrou du bucket n'est pas actif."
  PROTECTED=0
else
  log "✓ Écrasement refusé"
fi
if [ "$PROTECTED" -eq 1 ]; then
  log "✓ Sauvegardes protégées : les identifiants de ce serveur ne peuvent ni les supprimer ni les écraser."
else
  fail "Ajoutez la règle de verrouillage du bucket (docs/deploiement.md, étape R2)."
fi

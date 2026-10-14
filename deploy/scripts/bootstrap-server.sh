#!/usr/bin/env bash
# Préparation et sécurisation d'un serveur Ubuntu 24.04 neuf (Hetzner). À lancer UNE fois, en
# root, après avoir copié le dossier deploy/ dans /root/deploy (voir docs/deploiement.md).
# Relançable sans danger (chaque étape vérifie ce qui est déjà fait).
#
#   bash /root/deploy/scripts/bootstrap-server.sh
#
# Résultat :
#   - utilisateur « deploy » (connexion par clé SSH uniquement, droits Docker, sudo avec mot de
#     passe) ; connexion root et mots de passe SSH désactivés ;
#   - pare-feu : seuls SSH (22), HTTP (80) et HTTPS (443) sont ouverts ;
#   - mises à jour de sécurité automatiques, fail2ban sur SSH ;
#   - Docker, journaux conservés 30 jours (2 Go au plus), fuseau Africa/Casablanca, swap 2 Go ;
#   - /opt/traiteur prêt à recevoir la configuration ; minuteurs de sauvegarde installés.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "À lancer en root." >&2; exit 1; }
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_USER=deploy
ROOT=/opt/traiteur
export DEBIAN_FRONTEND=noninteractive
step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

# Garde-fou : sans clé SSH dans root, désactiver les mots de passe enfermerait dehors
[ -s /root/.ssh/authorized_keys ] || {
  echo "Aucune clé SSH dans /root/.ssh/authorized_keys : ajoutez votre clé au serveur d'abord." >&2
  exit 1
}

step "Mises à jour et paquets"
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  age rclone jq

step "Docker (dépôt officiel)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Journaux des conteneurs dans le journal système ; conteneurs maintenus pendant une mise à
# jour de Docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "journald",
  "live-restore": true
}
JSON
systemctl restart docker

step "Journaux : conservation 30 jours, 2 Go au plus"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/traiteur.conf <<'CONF'
[Journal]
Storage=persistent
MaxRetentionSec=30day
SystemMaxUse=2G
CONF
systemctl restart systemd-journald

step "Fuseau horaire et swap"
timedatectl set-timezone Africa/Casablanca
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Utilisateur $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' "$DEPLOY_USER"
fi
usermod -aG docker,sudo "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
# Votre clé personnelle (celle de root) ; la clé de GitHub Actions sera ajoutée ensuite,
# restreinte à ci-deploy.sh (voir le guide)
if [ ! -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys \
    "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

step "SSH : clé uniquement, root désactivé"
cat > /etc/ssh/sshd_config.d/10-traiteur.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
CONF
sshd -t
systemctl reload ssh

step "Pare-feu : SSH, HTTP, HTTPS uniquement"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
# Docker publie ses ports en contournant ufw : seul Caddy publie (80/443) ; PostgreSQL, Redis
# et les interfaces d'administration n'en publient aucun, ou seulement sur 127.0.0.1.

step "fail2ban (SSH)"
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

step "Mises à jour de sécurité automatiques (redémarrage si nécessaire à 05:00)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52traiteur-unattended <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "05:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF
systemctl enable --now unattended-upgrades

step "Dossier $ROOT"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT" "$ROOT/scripts"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT/secrets"
install -m 0644 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE/docker-compose.prod.yml" "$ROOT/"
install -m 0644 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE/Caddyfile" "$ROOT/"
install -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE"/scripts/*.sh "$ROOT/scripts/"
if [ ! -f "$ROOT/.env" ]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE/env.example" "$ROOT/.env"
fi
chmod 600 "$ROOT/.env"

step "Minuteurs : sauvegarde quotidienne (02:30), vérification hebdomadaire (dimanche 04:00)"
install -m 0644 "$SOURCE"/systemd/*.service "$SOURCE"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable traiteur-backup.timer traiteur-verify-backup.timer

cat <<'DONE'

✓ Serveur préparé.

Étapes suivantes (docs/deploiement.md) :
  1. Définir le mot de passe sudo de deploy :   passwd deploy
  2. Ouvrir une NOUVELLE session pour vérifier :  ssh deploy@<adresse du serveur>
     (ne fermez pas cette session root avant d'avoir vérifié !)
  3. Remplir /opt/traiteur/.env, créer la clé machine des sauvegardes, se connecter à GHCR,
     puis démarrer les minuteurs : sudo systemctl start traiteur-backup.timer traiteur-verify-backup.timer
DONE

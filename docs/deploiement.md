# Guide de déploiement

Ce guide vous accompagne de zéro jusqu'au traiteur pilote en production. Il est écrit pour
quelqu'un qui débute en administration de serveurs : chaque commande est donnée telle quelle,
avec ce qu'elle doit afficher. Prévoyez une demi-journée pour le staging, une heure pour la
production ensuite.

> Dans tout le guide, remplacez **`DOMAINE`** par votre nom de domaine (par exemple
> `dardiafa.ma`), **`IP_STAGING`** et **`IP_PROD`** par les adresses de vos serveurs, et
> **`VOTRE_COMPTE`** par votre nom d'utilisateur GitHub **en minuscules**.

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Ce que vous devez créer, dans l'ordre](#2-ce-que-vous-devez-créer-dans-lordre)
3. [Le domaine](#3-le-domaine)
4. [Cloudflare R2 : stockage et sauvegardes](#4-cloudflare-r2--stockage-et-sauvegardes)
5. [La clé de secours des sauvegardes](#5-la-clé-de-secours-des-sauvegardes)
6. [Le serveur de staging](#6-le-serveur-de-staging)
7. [Configuration du serveur](#7-configuration-du-serveur)
8. [GitHub : déploiement automatique](#8-github--déploiement-automatique)
9. [Premier déploiement du staging](#9-premier-déploiement-du-staging)
10. [Surveillance et alertes](#10-surveillance-et-alertes)
11. [Sauvegardes : vérifier qu'elles fonctionnent](#11-sauvegardes--vérifier-quelles-fonctionnent)
12. [La production](#12-la-production)
13. [Créer le traiteur pilote](#13-créer-le-traiteur-pilote)
14. [Checklist avant la mise en production](#14-checklist-avant-la-mise-en-production)
15. [Mettre à jour, revenir en arrière](#15-mettre-à-jour-revenir-en-arrière)
16. [Restaurer une sauvegarde](#16-restaurer-une-sauvegarde)
17. [Journaux et commandes utiles](#17-journaux-et-commandes-utiles)

---

## 1. Vue d'ensemble

```
                 ┌──────────────────────── Serveur (Hetzner, Ubuntu 24.04) ─────────────────┐
 Navigateur ─443─▶ Caddy (HTTPS automatique)                                                 │
                 │   ├─ /            → web    (back-office Next.js)                           │
                 │   └─ /api/        → api    (NestJS, rendu des PDF)                         │
                 │  worker (tâches de fond)   postgres   redis   ← réseau interne uniquement   │
                 │  dozzle (journaux)         ← 127.0.0.1 du serveur, tunnel SSH uniquement    │
                 └──────────────────────────────────────────────────────────────────────────┘
 Photos  ◀─ media.DOMAINE ─ Cloudflare R2 (bucket « media », public)
 Documents (factures, reçus, chèques) : bucket « documents », privé, liens signés de 5 minutes
 Sauvegardes chiffrées : bucket « backups », verrouillé 30 jours
```

- **Deux environnements séparés** : le **staging** (`staging.DOMAINE`, petit serveur CX23)
  pour essayer chaque nouvelle version avec des **données fictives uniquement**, et la
  **production** (`app.DOMAINE`, serveur CX33) pour le vrai traiteur. Bases, secrets, buckets
  et clés sont **tous différents** entre les deux : jamais de copie des données de production
  vers le staging.
- **Déploiement** : chaque modification poussée sur `main` est testée, transformée en images
  Docker par GitHub Actions, puis installée automatiquement sur le staging. La production ne
  reçoit une version que lorsque vous créez une étiquette (`v1.0.0`) **et** l'approuvez dans
  GitHub. C'est exactement la même image que celle testée en staging.
- **Coût mensuel estimé** : environ 15 à 16 € (CX33 ~9 €, CX23 ~5 €, domaine ~1 €/mois ;
  Cloudflare R2, Sentry, UptimeRobot, healthchecks.io et GitHub Actions restent gratuits au
  volume d'un pilote), plus les SMS (~0,35 à 0,50 MAD l'unité chez un agrégateur marocain).

## 2. Ce que vous devez créer, dans l'ordre

| #   | Quoi                                  | Où                                                        | Pourquoi                                           |
| --- | ------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| 1   | Nom de domaine                        | Cloudflare Registrar (.com) ou registraire marocain (.ma) | Adresses du site                                   |
| 2   | Compte Cloudflare + **2FA**           | cloudflare.com                                            | DNS, stockage R2                                   |
| 3   | Clé de secours des sauvegardes        | Votre ordinateur                                          | Déchiffrer les sauvegardes si le serveur disparaît |
| 4   | Compte Hetzner + **2FA**              | hetzner.com                                               | Serveurs                                           |
| 5   | Clé SSH personnelle                   | Votre ordinateur                                          | Connexion aux serveurs                             |
| 6   | Environnements GitHub + **2FA**       | github.com, votre dépôt                                   | Déploiement                                        |
| 7   | Sentry, UptimeRobot, healthchecks.io  | Sites respectifs (gratuits)                               | Erreurs et alertes                                 |
| 8   | Fournisseur SMS (essais puis contrat) | Agrégateur marocain + Twilio                              | Codes de connexion, invitations                    |

Activez la **double authentification (2FA)** partout : quelqu'un qui prendrait votre compte
Cloudflare pourrait retirer le verrou des sauvegardes ; votre compte GitHub peut déployer.

**Outils à installer sur votre PC Windows** (PowerShell) :

```powershell
winget install FiloSottile.age     # chiffrement des sauvegardes
# OpenSSH (ssh, scp, ssh-keygen) est déjà inclus dans Windows 10/11
```

## 3. Le domaine

Choisissez `DOMAINE` (par exemple `dardiafa.ma`). Vous utiliserez :

| Adresse                 | Rôle                             |
| ----------------------- | -------------------------------- |
| `app.DOMAINE`           | back-office en production        |
| `staging.DOMAINE`       | back-office de test              |
| `media.DOMAINE`         | photos de production (bucket R2) |
| `media-staging.DOMAINE` | photos du staging (bucket R2)    |

### Cas A : domaine .com acheté chez Cloudflare Registrar

1. Cloudflare › **Domain Registration** › **Register Domains** › cherchez et achetez le nom.
2. C'est tout : le domaine est déjà géré par le DNS de Cloudflare.

### Cas B : domaine .ma chez un registraire marocain

Les .ma s'achètent chez un registraire agréé par l'ANRT (Genious Communications, Maroc
Telecom, etc.). Ensuite, on **délègue** le DNS à Cloudflare (gratuit) :

1. Cloudflare › **Add a domain** › saisissez `DOMAINE` › offre **Free**.
2. Cloudflare affiche **deux serveurs de noms** (par exemple `anna.ns.cloudflare.com` et
   `bob.ns.cloudflare.com`). Notez-les.
3. Dans l'espace client du registraire, remplacez les serveurs de noms (« NS », « DNS
   servers ») par ces deux-là. Si l'option n'existe pas, demandez-le au support du registraire.
4. Attendez l'e-mail « Your domain is now active on Cloudflare » (de quelques minutes à 24 h).

Dans les deux cas, **ne créez pas encore** les enregistrements : vous le ferez quand les
serveurs auront une adresse IP (étapes 6 et 12).

## 4. Cloudflare R2 : stockage et sauvegardes

Cloudflare › **R2 Object Storage** (une carte bancaire est demandée, même pour l'offre
gratuite). Notez votre **Account ID** (colonne de droite) : l'adresse S3 est
`https://ACCOUNT_ID.r2.cloudflarestorage.com`.

### 4.1 Six buckets

Créez (bouton **Create bucket**, emplacement automatique) :

| Bucket                       | Accès public                              | Contenu                         |
| ---------------------------- | ----------------------------------------- | ------------------------------- |
| `traiteur-staging-media`     | **Oui** : domaine `media-staging.DOMAINE` | Photos du staging               |
| `traiteur-staging-documents` | **Non**                                   | Documents du staging            |
| `traiteur-staging-backups`   | **Non**                                   | Sauvegardes du staging          |
| `traiteur-prod-media`        | **Oui** : domaine `media.DOMAINE`         | Photos de production            |
| `traiteur-prod-documents`    | **Non**                                   | Factures, reçus, devis, chèques |
| `traiteur-prod-backups`      | **Non**                                   | Sauvegardes de production       |

> **Jamais** d'accès public sur un bucket `documents` ou `backups`. R2 ne sait pas rendre
> public seulement une partie d'un bucket : c'est pour cela que photos et documents sont dans
> des buckets séparés (un test de l'application le vérifie).

### 4.2 Domaine public des photos

Pour chaque bucket `media` : **Settings** › **Custom Domains** › **Connect Domain** ›
`media.DOMAINE` (ou `media-staging.DOMAINE`). Cloudflare crée l'enregistrement DNS tout seul.

### 4.3 CORS des buckets documents

Le navigateur envoie les photos d'origine directement dans le bucket `documents` (zone
`tmp/`, avant traitement). Pour chaque bucket `documents` : **Settings** › **CORS Policy** ›
**Add CORS policy** :

```json
[
  {
    "AllowedOrigins": ["https://staging.DOMAINE"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

(`https://app.DOMAINE` pour `traiteur-prod-documents`.)

### 4.4 Verrouillage des sauvegardes (protection contre un piratage)

Si un pirate ou un rançongiciel prend le contrôle d'un serveur, il aura les identifiants R2
de ce serveur. Le **verrou du bucket** l'empêche de supprimer ou d'écraser les sauvegardes,
quels que soient ces identifiants. Pour chaque bucket `backups` :

1. **Settings** › **Bucket lock rules** › **Add rule** : nom `retention-30-jours`, préfixe
   **vide** (tout le bucket), durée **30 jours**.
2. **Settings** › **Object lifecycle rules** › **Add rule** : nom `suppression-31-jours`,
   préfixe vide, **Delete objects** après **31 jours**.

Les sauvegardes sont ainsi conservées au moins 30 jours, puis supprimées **uniquement** par
cette règle (le script de sauvegarde ne supprime jamais rien). La règle de suppression est au
31e jour pour ne pas buter sur le verrou. Seul votre compte Cloudflare (protégé par la 2FA)
pourrait retirer le verrou : le serveur n'en a pas les droits.

### 4.5 Quatre jetons d'accès

**R2** › **Manage R2 API Tokens** › **Create API token**, type **Object Read & Write**,
**Apply to specific buckets only** :

| Jeton             | Buckets autorisés                                      | Variables du `.env`                                      |
| ----------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `staging-app`     | `traiteur-staging-media`, `traiteur-staging-documents` | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`               |
| `staging-backups` | `traiteur-staging-backups`                             | `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` |
| `prod-app`        | `traiteur-prod-media`, `traiteur-prod-documents`       | (même chose, serveur de production)                      |
| `prod-backups`    | `traiteur-prod-backups`                                | (même chose, serveur de production)                      |

Cloudflare n'affiche la clé secrète **qu'une fois** : copiez-la directement dans le `.env` du
serveur (étape 7), ou dans votre gestionnaire de mots de passe en attendant. Ne créez **jamais**
de jeton « Admin » pour un serveur.

## 5. La clé de secours des sauvegardes

Chaque sauvegarde est chiffrée pour **deux** clés :

- la **clé machine**, sur le serveur : elle sert à la vérification automatique de chaque
  dimanche (une sauvegarde jamais restaurée ne compte pas) ;
- la **clé de secours**, que **vous seul** détenez, hors serveur : elle sert si le serveur est
  détruit, perdu ou piraté.

Sur votre PC (PowerShell), dans un dossier personnel :

```powershell
age-keygen -o secours-traiteur-prod.key
```

La commande affiche `Public key: age1…` : c'est la **clé publique** (elle peut être copiée
partout). Le fichier `secours-traiteur-prod.key` contient la **clé privée**.

> ### ⚠️ Conservez la clé privée à DEUX endroits
>
> 1. Dans votre **gestionnaire de mots de passe** (Bitwarden, 1Password, KeePass…) : ouvrez
>    le fichier avec le Bloc-notes et copiez **tout** son contenu dans une note sécurisée.
> 2. Sur une **copie papier** imprimée, rangée en lieu sûr (coffre, chez un proche de
>    confiance).
>
> **Sans cette clé, les sauvegardes sont inutilisables** si le serveur disparaît. Personne,
> pas même Cloudflare, ne peut les déchiffrer à votre place. Ne la mettez **jamais** sur un
> serveur, dans le dépôt Git, ni dans un e-mail.
>
> Ensuite, supprimez le fichier du PC (il est dans vos deux coffres).

Faites de même pour le staging (`secours-traiteur-staging.key`), ou réutilisez une clé de
staging moins précieuse : ses données sont fictives.

## 6. Le serveur de staging

### 6.1 Votre clé SSH

Sur votre PC (PowerShell) :

```powershell
ssh-keygen -t ed25519 -C "votre-email@exemple.ma"
# Entrée pour l'emplacement par défaut, puis choisissez une phrase de passe
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

La dernière commande affiche votre **clé publique** (`ssh-ed25519 AAAA…`).

### 6.2 Créer le serveur

Hetzner Cloud › **New project** « traiteur » › **Add Server** :

- **Location** : Falkenstein ou Nuremberg (Allemagne) ;
- **Image** : Ubuntu 24.04 ;
- **Type** : Shared vCPU › **CX23** (staging) ;
- **Networking** : IPv4 et IPv6 ;
- **SSH keys** : **Add SSH key**, collez votre clé publique ;
- **Firewalls** (recommandé, en plus du pare-feu du serveur) : créez « web » avec les règles
  entrantes TCP 22, TCP 80, TCP 443, UDP 443 ;
- **Name** : `traiteur-staging`.

Notez l'adresse IPv4 : `IP_STAGING`.

### 6.3 DNS du staging

Cloudflare › votre domaine › **DNS** › **Add record** : type **A**, nom `staging`, contenu
`IP_STAGING`, **Proxy status : DNS only** (nuage **gris**). Caddy doit être le seul proxy
devant l'application (voir « IP réelle des clients » dans le README).

### 6.4 Sécuriser le serveur

Depuis le dossier du dépôt sur votre PC (PowerShell) :

```powershell
scp -r deploy root@IP_STAGING:/root/deploy
ssh root@IP_STAGING
```

Puis, sur le serveur :

```bash
bash /root/deploy/scripts/bootstrap-server.sh
passwd deploy          # mot de passe pour les commandes « sudo » (gestionnaire de mots de passe)
```

Le script installe Docker, active le pare-feu (seuls 22, 80 et 443), les mises à jour de
sécurité automatiques et fail2ban, crée l'utilisateur `deploy`, puis **désactive la connexion
root et les mots de passe SSH**.

> **Avant de fermer la session root**, ouvrez une **deuxième** fenêtre PowerShell et vérifiez :
> `ssh deploy@IP_STAGING` doit fonctionner. Si ce n'est pas le cas, corrigez depuis la
> première session (sinon, Hetzner › serveur › **Console** permet toujours de se connecter).

Toutes les commandes suivantes se font en tant que `deploy` (`ssh deploy@IP_STAGING`).

## 7. Configuration du serveur

### 7.1 Le fichier `.env`

```bash
cd /opt/traiteur
nano .env
```

Le fichier contient chaque variable avec son explication. Pour chaque secret, générez la
valeur **sur le serveur** avec la commande indiquée et collez-la :

| Variable            | Commande                  |
| ------------------- | ------------------------- |
| `POSTGRES_PASSWORD` | `openssl rand -hex 32`    |
| `REDIS_PASSWORD`    | `openssl rand -hex 32`    |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` |
| `OTP_SECRET`        | `openssl rand -base64 48` |

Valeurs du staging : `ENVIRONMENT=staging`, `APP_HOST=staging.DOMAINE`,
`MEDIA_HOST=media-staging.DOMAINE`, `ROBOTS=noindex, nofollow`, `TRAITEUR_SLUG=dar-diafa`,
`ALLOW_DEMO_SEED=true`, `IMAGE_REGISTRY=ghcr.io/VOTRE_COMPTE`, les buckets et jetons
`staging` de l'étape 4. Gardez les valeurs de mémoire réduites indiquées en bas du fichier
(serveur de 4 Go).

Enregistrez (`Ctrl+O`, `Entrée`, `Ctrl+X`), puis vérifiez qu'aucun secret n'est vide et que
le fichier est protégé :

```bash
grep -nE '^(POSTGRES_PASSWORD|REDIS_PASSWORD|JWT_ACCESS_SECRET|OTP_SECRET|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|BACKUP_S3_ACCESS_KEY_ID|BACKUP_S3_SECRET_ACCESS_KEY)=$' .env \
  && echo "⚠ secrets manquants ci-dessus" || echo "✓ secrets renseignés"
ls -l .env      # doit commencer par -rw------- deploy deploy
```

### 7.2 La clé machine des sauvegardes

```bash
age-keygen -o /opt/traiteur/secrets/backup-machine.key
chmod 600 /opt/traiteur/secrets/backup-machine.key
age-keygen -y /opt/traiteur/secrets/backup-machine.key     # affiche la clé publique machine
```

Dans `.env`, `BACKUP_AGE_RECIPIENTS` = **clé publique de secours** (étape 5), une espace,
**clé publique machine** :

```
BACKUP_AGE_RECIPIENTS=age1…secours… age1…machine…
```

### 7.3 Accès aux images (GitHub Container Registry)

Les images sont privées. GitHub › **Settings** (de votre compte) › **Developer settings** ›
**Personal access tokens** › **Tokens (classic)** › **Generate new token** : nom
`ghcr-staging`, expiration 1 an, **une seule** case : `read:packages`. Puis sur le serveur :

```bash
docker login ghcr.io -u VOTRE_COMPTE
# Password : collez le jeton (lecture seule des images, rien d'autre)
```

Notez dans votre agenda la date d'expiration du jeton (le renouveler avant).

## 8. GitHub : déploiement automatique

### 8.1 La clé de déploiement (restreinte)

GitHub Actions se connecte au serveur avec une clé **dédiée**, restreinte à une seule action :
déployer une version. Même volée, elle ne permet ni d'ouvrir un terminal ni de lire le `.env`.

Sur votre PC :

```powershell
ssh-keygen -t ed25519 -N '""' -C github-actions-staging -f github-deploy-staging
type github-deploy-staging.pub
```

Sur le serveur (`deploy`), ajoutez cette clé **avec sa restriction** (une seule ligne) :

```bash
echo 'command="/opt/traiteur/scripts/ci-deploy.sh",restrict ssh-ed25519 AAAA…(contenu de github-deploy-staging.pub)… github-actions-staging' >> ~/.ssh/authorized_keys
```

Empreinte du serveur, à faire **depuis votre PC** :

```powershell
ssh-keyscan -t ed25519 IP_STAGING
```

### 8.2 Environnements et secrets

Dépôt GitHub › **Settings** › **Environments** › **New environment** `staging` :

| Secret            | Valeur                                                              |
| ----------------- | ------------------------------------------------------------------- |
| `SSH_HOST`        | `IP_STAGING`                                                        |
| `SSH_PRIVATE_KEY` | contenu **complet** du fichier `github-deploy-staging` (clé privée) |
| `SSH_KNOWN_HOSTS` | la ligne affichée par `ssh-keyscan`                                 |

Puis **Settings** › **Secrets and variables** › **Actions** › onglet **Variables** ›
**New repository variable** : `DEPLOY_STAGING` = `true`.

Supprimez ensuite les fichiers `github-deploy-staging*` de votre PC (la clé privée est dans
GitHub, et vous pouvez toujours en créer une nouvelle).

## 9. Premier déploiement du staging

Le déploiement part tout seul à chaque push sur `main`, une fois la CI réussie. Pour le
premier, déclenchez-le à la main : GitHub › **Actions** › **Déploiement** › **Run workflow** ›
environnement `staging`, version `sha-xxxxxxx` (les 7 premiers caractères du dernier commit
de `main`, dont les images ont été construites par le workflow « Déploiement »).

Pendant ce temps, sur le serveur : `/opt/traiteur/scripts/compose.sh ps` doit montrer `api`,
`web` et `caddy` « healthy » ou « running ». Ouvrez `https://staging.DOMAINE/admin` : le
certificat HTTPS est obtenu automatiquement au premier accès (quelques secondes).

**Données de démonstration** (staging uniquement, fictives) :

```bash
/opt/traiteur/scripts/compose.sh run --rm api node dist-seed/prisma/seed.js
```

Connectez-vous avec un compte de démonstration (README, « Comptes de démonstration »).

## 10. Surveillance et alertes

### 10.1 Sentry (erreurs)

sentry.io › compte gratuit (offre Developer) › **Create Project** › plateforme **Node.js**,
nom `traiteur` › copiez le **DSN** dans `SENTRY_DSN` du `.env` (staging et production : le
champ `ENVIRONMENT` les distingue dans Sentry). **Settings** › **Security & Privacy** :
activez **Data Scrubber** et **Use Default Scrubbers** (en plus du filtrage de l'application).
Puis `./compose.sh up -d` pour prendre en compte le DSN.

Aucune donnée personnelle n'est envoyée (téléphones, e-mails, noms, adresses, jetons, mots
de passe, cookies et corps des requêtes sont retirés avant l'envoi, ce qui est testé).

**Alertes** : Sentry › **Alerts** › **Create Alert** › « Issues » › « A new issue is created »
› action « Send a notification to » votre e-mail. Pour Telegram, Sentry n'a pas d'intégration
gratuite directe : passez par l'e-mail, ou recevez les alertes de disponibilité ci-dessous
sur Telegram.

### 10.2 Disponibilité du site (UptimeRobot)

uptimerobot.com › compte gratuit :

1. **Alert Contacts** : ajoutez votre **e-mail** et **Telegram** (« Add Alert Contact » ›
   Telegram › suivez le lien vers le bot UptimeRobot et appuyez sur Start).
2. **Add New Monitor** › **HTTP(s)** › `https://staging.DOMAINE/api/v1/health`, intervalle
   5 minutes, cochez les deux contacts. Faites de même pour `https://app.DOMAINE/api/v1/health`
   et `https://app.DOMAINE/admin/login`.

### 10.3 Tâches de sauvegarde (healthchecks.io)

healthchecks.io › compte gratuit › **Integrations** : e-mail et **Telegram** (lien vers le
bot). Créez deux contrôles par environnement :

| Contrôle               | Période | Marge    | Variable du `.env`       |
| ---------------------- | ------- | -------- | ------------------------ |
| `staging-sauvegarde`   | 1 jour  | 2 heures | `HEALTHCHECK_BACKUP_URL` |
| `staging-verification` | 7 jours | 1 jour   | `HEALTHCHECK_VERIFY_URL` |

Copiez l'URL de « ping » de chaque contrôle dans le `.env`. Vous êtes alerté si une
sauvegarde échoue **ou ne s'exécute pas**. Puis démarrez les minuteurs :

```bash
sudo systemctl start traiteur-backup.timer traiteur-verify-backup.timer
systemctl list-timers 'traiteur-*'      # prochaines exécutions
```

## 11. Sauvegardes : vérifier qu'elles fonctionnent

Une sauvegarde qui n'a jamais été restaurée ne compte pas. Sur le serveur :

```bash
cd /opt/traiteur/scripts
./backup.sh                 # première sauvegarde : « ✓ Sauvegarde terminée »
./restore.sh --list         # elle apparaît
./restore.sh                # restauration dans une base jetable : « ✓ Test de restauration réussi »
./check-backup-lock.sh      # « ✓ Suppression refusée » et « ✓ Écrasement refusé »
```

Si `check-backup-lock.sh` indique que la suppression est acceptée, le verrou de l'étape 4.4
n'est pas en place : corrigez avant d'aller plus loin.

**Vérifiez aussi votre clé de secours**, depuis votre PC : téléchargez une sauvegarde
(Cloudflare › R2 › bucket `backups` › fichier › **Download**), puis :

```powershell
age -d -i secours-traiteur-staging.key -o NUL traiteur-staging-….dump.age
```

Aucun message d'erreur : la clé de secours ouvre bien les sauvegardes. (Recopiez
temporairement la clé depuis votre gestionnaire de mots de passe, puis supprimez le fichier.)

## 12. La production

Mêmes étapes que le staging, avec ces différences :

| Étape | Production                                                                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.2   | Type **CX33**, nom `traiteur-prod` ; option **Backups** Hetzner conseillée (+20 %, copie complète du serveur)                                                                                                                                                                                                        |
| 6.3   | Enregistrement **A** `app` → `IP_PROD`, nuage gris                                                                                                                                                                                                                                                                   |
| 7.1   | `ENVIRONMENT=production`, `APP_HOST=app.DOMAINE`, `MEDIA_HOST=media.DOMAINE`, `ROBOTS=all`, **`ALLOW_DEMO_SEED=false`**, buckets et jetons `prod`, **nouveaux** secrets (jamais ceux du staging), supprimez les lignes de mémoire réduite (valeurs par défaut) ; `SMS_PROVIDER=http`, `SMS_FALLBACK_PROVIDER=twilio` |
| 7.2   | Clé de secours **de production**                                                                                                                                                                                                                                                                                     |
| 7.3   | Jeton `ghcr-prod` distinct                                                                                                                                                                                                                                                                                           |
| 8.1   | Clé `github-deploy-prod`, ajoutée sur le serveur de production                                                                                                                                                                                                                                                       |
| 8.2   | Environnement **`production`** : mêmes trois secrets avec les valeurs de production, et **Required reviewers** = vous (approbation obligatoire) ; variable `DEPLOY_PRODUCTION` = `true`                                                                                                                              |
| 9     | **Pas de seed de démonstration** (il est d'ailleurs refusé)                                                                                                                                                                                                                                                          |

**Fournisseur SMS** (production) : après vos essais, renseignez `SMS_HTTP_*` selon la
documentation de l'agrégateur retenu (exemples dans `apps/api/.env.example`), le nom
d'expéditeur validé dans `SMS_SENDER`, et Twilio en secours (`TWILIO_*`).

**Mise en production d'une version** : sur votre PC, dans le dépôt :

```powershell
git checkout main
git pull
git tag v1.0.0
git push origin v1.0.0
```

GitHub › **Actions** › **Déploiement** › le job « Production » attend votre approbation ›
**Review deployments** › **Approve**. La version testée en staging est installée.

## 13. Créer le traiteur pilote

Sur le serveur de **production** :

```bash
/opt/traiteur/scripts/compose.sh run --rm api node dist/cli/create-traiteur.js \
  --slug dar-diafa --name "Dar Diafa" --email contact@dardiafa.ma --phone 0522000000 \
  --city Casablanca --plan PRO \
  --admin-phone 0612345678 --admin-first-name Karim --admin-last-name Benjelloun
```

La commande affiche un **lien d'activation** (valable 7 jours) : envoyez-le à l'administrateur
(WhatsApp, SMS). Il choisira lui-même son mot de passe : aucun mot de passe ne passe par la
ligne de commande. Ensuite :

```bash
nano /opt/traiteur/.env                 # TRAITEUR_SLUG=dar-diafa
/opt/traiteur/scripts/compose.sh up -d web
```

L'administrateur complète ensuite les paramètres (Entreprise, Documents, Disponibilités) et
invite son équipe depuis le back-office.

## 14. Checklist avant la mise en production

Imprimez cette liste et cochez chaque ligne **sur le serveur de production** avant d'ouvrir
le service au traiteur pilote.

**Secrets et configuration**

- [ ] Tous les secrets générés avec les commandes de l'étape 7.1, **différents** du staging
      (commande de vérification de l'étape 7.1 : « ✓ secrets renseignés »)
- [ ] `.env` en `-rw------- deploy deploy` (`ls -l /opt/traiteur/.env`)
- [ ] `ALLOW_DEMO_SEED=false`, `ROBOTS=all`, `ENVIRONMENT=production`
- [ ] SMS réel configuré : demandez un code de connexion sur votre propre téléphone, il arrive
- [ ] 2FA activée sur Cloudflare, Hetzner, GitHub et Sentry

**Sauvegardes**

- [ ] `./backup.sh` réussi, puis `./restore.sh` : « ✓ Test de restauration réussi »
- [ ] `./check-backup-lock.sh` : suppression **et** écrasement refusés
- [ ] Clé de secours testée (étape 11) et rangée à **deux** endroits : gestionnaire de mots de
      passe + copie papier
- [ ] Minuteurs actifs : `systemctl list-timers 'traiteur-*'` montre les deux prochaines dates

**Alertes testées** (vous devez recevoir chaque alerte par e-mail **et** Telegram)

- [ ] Site indisponible : `./compose.sh stop web api`, attendez l'alerte UptimeRobot (≤ 10 min),
      puis `./compose.sh up -d` et attendez l'alerte de retour
- [ ] Sauvegarde en échec : `curl -fsS "$(grep ^HEALTHCHECK_BACKUP_URL= .env | cut -d= -f2-)/fail"`
      → alerte healthchecks.io (puis `./backup.sh` pour revenir au vert)
- [ ] Erreur applicative : la commande ci-dessous crée une erreur de test, visible dans Sentry
      (et l'e-mail d'alerte) en moins d'une minute :

  ```bash
  ./compose.sh run --rm api node -e "require('./dist/observability/instrument-api'); const S=require('@sentry/node'); S.captureException(new Error('Test des alertes Sentry')); S.flush(5000)"
  ```

**HTTPS** (depuis votre PC, PowerShell)

- [ ] Certificat valide : `curl.exe -sI https://app.DOMAINE/admin/login` → `HTTP/1.1 200` ou
      `HTTP/2 200`, sans erreur de certificat
- [ ] Redirection : `curl.exe -sI http://app.DOMAINE/` → `308 Permanent Redirect` vers `https://`
- [ ] Note **A** ou **A+** sur https://www.ssllabs.com/ssltest/ (saisissez `app.DOMAINE`)

**En-têtes de sécurité**

- [ ] `curl.exe -sI https://app.DOMAINE/admin/login` montre `strict-transport-security`,
      `x-content-type-options: nosniff`, `referrer-policy`, et **pas** d'en-tête `server`
- [ ] `curl.exe -sI https://app.DOMAINE/api/v1/health` montre en plus les en-têtes Helmet
      (`content-security-policy`, `x-frame-options`…)
- [ ] https://securityheaders.com/ (saisissez `https://app.DOMAINE/admin/login`) : note A
      ou mieux
- [ ] Le staging n'est pas indexable : `curl.exe -sI https://staging.DOMAINE/admin/login`
      montre `x-robots-tag: noindex, nofollow`

**Ports ouverts, vus de l'extérieur** (depuis votre PC, PowerShell)

```powershell
foreach ($p in 22,80,443,3000,3001,5432,6379,9999) {
  $r = Test-NetConnection IP_PROD -Port $p -WarningAction SilentlyContinue
  "{0,5} : {1}" -f $p, ($(if ($r.TcpTestSucceeded) {'OUVERT'} else {'fermé'}))
}
```

- [ ] **Ouverts** : 22, 80, 443 uniquement
- [ ] **Fermés** : 3000 (API), 3001 (web), 5432 (PostgreSQL), 6379 (Redis), 9999 (journaux)
- [ ] Connexion root refusée : `ssh root@IP_PROD` → « Permission denied »
- [ ] Mot de passe refusé : `ssh -o PubkeyAuthentication=no deploy@IP_PROD` → « Permission denied »

**Données**

- [ ] Le staging ne contient **que** des données fictives (aucune copie de la production, jamais)
- [ ] Le traiteur pilote a été créé par `create-traiteur` (pas de seed), son administrateur
      s'est connecté et a changé ses paramètres

## 15. Mettre à jour, revenir en arrière

**Mise à jour** : poussez sur `main` → le staging se met à jour tout seul. Testez-le, puis
créez une nouvelle étiquette (`v1.0.1`, `v1.1.0`…) et approuvez-la (étape 12).

Chaque déploiement :

1. télécharge les images de la version ;
2. **sauvegarde la base** (fichier `…-avant-v1.0.1.dump.age`) ;
3. applique les migrations de base de données ;
4. redémarre les services et vérifie qu'ils répondent ;
5. si ce n'est pas le cas, **revient tout seul** à la version précédente.

L'historique est dans `/opt/traiteur/deploy-history.log`.

**Retour en arrière manuel** (un problème découvert après coup) : GitHub › **Actions** ›
**Déploiement** › **Run workflow** › environnement, version précédente (par exemple
`v1.0.0`). C'est immédiat si la nouvelle version n'a pas modifié la base de données.

**Si la nouvelle version a modifié la base** (migration) et que l'ancienne version ne
fonctionne plus avec : les migrations ne s'annulent pas toutes seules. Restaurez la sauvegarde
prise juste avant le déploiement, puis redéployez l'ancienne version :

```bash
cd /opt/traiteur/scripts
./restore.sh --list | grep avant-v1.0.1                     # la sauvegarde d'avant le déploiement
./restore.sh --live 2026/10/traiteur-production-…-avant-v1.0.1.dump.age
```

puis **Run workflow** avec `v1.0.0`. Attention : les données saisies **entre** le déploiement
et la restauration sont perdues. Avant toute restauration en production, prévenez le
traiteur et notez ce qui a été saisi entre-temps.

## 16. Restaurer une sauvegarde

| Situation                                             | Commande (sur le serveur, dans `/opt/traiteur/scripts`) |
| ----------------------------------------------------- | ------------------------------------------------------- |
| **Tester** la dernière sauvegarde (sans rien toucher) | `./restore.sh`                                          |
| Tester une sauvegarde précise                         | `./restore.sh 2026/10/traiteur-production-….dump.age`   |
| **Remplacer** la base par la dernière sauvegarde      | `./restore.sh --live latest`                            |
| Remplacer par une sauvegarde précise                  | `./restore.sh --live 2026/10/….dump.age`                |

`--live` demande de taper le nom de l'environnement pour confirmer, prend d'abord une
sauvegarde de sécurité de la base actuelle (`…-avant-restauration…`), arrête l'API, le worker
et le back-office, restaure, puis redémarre.

### Le serveur est perdu ou piraté

1. Créez un **nouveau** serveur et refaites les étapes 6 et 7, avec de **nouveaux** secrets
   (considérez les anciens comme compromis : régénérez aussi les jetons R2 et GHCR).
2. Déployez la dernière version (étape 9 ou 12).
3. Recopiez **temporairement** la clé de secours sur le serveur (depuis votre gestionnaire de
   mots de passe) :

   ```bash
   nano /opt/traiteur/secrets/secours.key      # collez la clé privée
   chmod 600 /opt/traiteur/secrets/secours.key
   cd /opt/traiteur/scripts
   ./restore.sh --identity /opt/traiteur/secrets/secours.key            # test
   ./restore.sh --live latest --identity /opt/traiteur/secrets/secours.key
   shred -u /opt/traiteur/secrets/secours.key  # effacée après usage
   ```

4. Mettez à jour le DNS si l'adresse IP a changé (étape 6.3).

Le script de restauration est testé en conditions réelles à chaque modification
(`deploy/tests/backup-restore.sh`, exécuté par la CI) : sauvegarde chiffrée, restauration
avec la clé machine et avec la clé de secours, refus d'une autre clé, base détruite puis
restaurée à l'identique.

## 17. Journaux et commandes utiles

Toutes les commandes se lancent sur le serveur, connecté en `deploy`.

| Besoin                        | Commande                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| État des services             | `/opt/traiteur/scripts/compose.sh ps`                                |
| Journaux en direct            | `/opt/traiteur/scripts/compose.sh logs -f --tail 100 api`            |
| Journaux d'hier               | `journalctl CONTAINER_TAG=traiteur/traiteur-api-1 --since yesterday` |
| Redémarrer un service         | `/opt/traiteur/scripts/compose.sh restart web`                       |
| Version en service            | `cat /opt/traiteur/.image.env`                                       |
| Prochaines sauvegardes        | `systemctl list-timers 'traiteur-*'`                                 |
| Dernière sauvegarde (journal) | `journalctl -u traiteur-backup --since today`                        |
| Espace disque                 | `df -h /` et `docker system df`                                      |

Les journaux sont conservés **30 jours** (2 Go au plus), puis effacés automatiquement.

### Interface des journaux (Dozzle), par tunnel SSH uniquement

Dozzle n'est **jamais** accessible depuis Internet : il n'écoute que sur le serveur lui-même.
Pour l'ouvrir depuis votre PC, créez un tunnel SSH (PowerShell, laissez la fenêtre ouverte) :

```powershell
ssh -N -L 9999:127.0.0.1:9999 deploy@IP_PROD
```

puis ouvrez http://localhost:9999 dans votre navigateur. Fermez la fenêtre PowerShell pour
couper l'accès. La même règle s'applique à toute future interface d'administration : jamais
de port public, toujours un tunnel SSH.

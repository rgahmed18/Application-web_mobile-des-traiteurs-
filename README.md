# Gestion Traiteurs

Plateforme SaaS multi-traiteurs (marque blanche) pour les traiteurs de fêtes au Maroc :
mariages, fiançailles, anniversaires, événements d'entreprise.

- **Back-office web** du traiteur : catalogue, commandes, calendrier, devis, factures, paiements, personnel
- **Site web et application mobile client** : catalogue, devis, réservation, paiement, suivi
- **Application mobile équipe** : personnel et livreurs
- **Chatbot IA** (application + WhatsApp Business), prévu plus tard

Acteurs : `CLIENT`, `ADMIN_TRAITEUR`, `EMPLOYE`, `LIVREUR`, `SUPER_ADMIN`.
Langues : français et arabe (RTL), anglais facultatif. Devise par défaut : MAD.

---

## Sommaire

1. [Prérequis](#prérequis)
2. [Installation](#installation)
3. [Lancer le projet](#lancer-le-projet)
4. [Comptes de démonstration](#comptes-de-démonstration)
5. [Back-office web](#back-office-web)
6. [Tester l'authentification](#tester-lauthentification)
7. [Structure du monorepo](#structure-du-monorepo)
8. [Choix d'architecture](#choix-darchitecture)
9. [Tests et qualité](#tests-et-qualité)
10. [Référence des commandes](#référence-des-commandes)
11. [Dépannage](#dépannage)

---

## Prérequis

| Outil          | Version                | Remarque                                              |
| -------------- | ---------------------- | ----------------------------------------------------- |
| Node.js        | **24 LTS** (ou 22.23+) | Node 22.13 et antérieurs font planter le CLI NestJS   |
| pnpm           | 10.x                   | `npm i -g pnpm@10`                                    |
| Docker Desktop | récent                 | PostgreSQL 17, Redis 7, stockage S3 (RustFS)          |
| Expo Go        | facultatif             | Pour ouvrir les applications mobiles sur un téléphone |

## Installation

```bash
# 1. Dépendances
pnpm install

# 2. Variables d'environnement (un fichier par application)
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/mobile-client/.env.example apps/mobile-client/.env
cp apps/mobile-staff/.env.example apps/mobile-staff/.env
```

Dans `apps/api/.env`, remplacez `JWT_ACCESS_SECRET` et `OTP_SECRET` par deux secrets aléatoires
distincts (32 caractères minimum) :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> L'API valide toutes ses variables d'environnement au démarrage et refuse de démarrer
> si l'une d'elles est absente ou invalide (voir `apps/api/src/config/env.schema.ts`).

```bash
# 3. PostgreSQL + Redis + stockage des photos (RustFS, compatible S3)
pnpm docker:up

# 4. Base de données : migrations puis données de démonstration
pnpm db:migrate
pnpm db:seed
```

PostgreSQL est exposé sur le port **5433** (et non 5432) pour ne pas entrer en conflit avec une
installation locale. Au premier démarrage, Docker crée aussi la base `gestion_traiteurs_test`
utilisée par les tests d'intégration.

Les photos du catalogue sont stockées dans **RustFS** (compatible S3), lancé par docker compose :
API S3 sur le port **9000**, console web sur http://localhost:9001 (identifiants `traiteur` /
`traiteur-secret`). L'API crée le bucket `traiteur-media`, sa lecture publique (photos traitées
uniquement) et son CORS au démarrage (`S3_AUTO_SETUP=true`). En production : Cloudflare R2,
voir les commentaires de `apps/api/.env.example`.

## Lancer le projet

```bash
pnpm dev          # toutes les applications en parallèle (Turborepo)
pnpm dev:api      # API seule
pnpm dev:web      # site web seul
```

| Application       | URL / commande                                           |
| ----------------- | -------------------------------------------------------- |
| API               | http://localhost:3000/api/v1                             |
| Swagger (doc API) | http://localhost:3000/docs                               |
| Back-office       | http://localhost:3001/admin                              |
| Console RustFS    | http://localhost:9001                                    |
| Mobile client     | `pnpm --filter @traiteur/mobile-client dev` puis Expo Go |
| Mobile équipe     | `pnpm --filter @traiteur/mobile-staff dev` puis Expo Go  |
| Prisma Studio     | `pnpm --filter @traiteur/api db:studio`                  |

Depuis un téléphone physique, remplacez `localhost` par l'adresse IP locale de votre PC dans
`EXPO_PUBLIC_API_URL`.

## Comptes de démonstration

Le seed crée le traiteur **Dar Diafa Traiteur** (slug `dar-diafa`, offre PRO, prix saisis TTC),
un catalogue marocain bilingue (6 catégories, 21 plats, 3 formules, 4 services) illustré par des
images générées, une commande de fiançailles avec devis, facture, acompte et équipe affectée.

Mot de passe commun : **`Password123!`**

| Rôle           | Téléphone     | Email                           |
| -------------- | ------------- | ------------------------------- |
| SUPER_ADMIN    | +212600000001 | superadmin@gestion-traiteurs.ma |
| ADMIN_TRAITEUR | +212600000002 | admin@dar-diafa.ma              |
| EMPLOYE        | +212600000003 | employe@dar-diafa.ma            |
| LIVREUR        | +212600000004 | livreur@dar-diafa.ma            |
| CLIENT         | +212600000005 | client@exemple.ma               |

Le seed est **idempotent** : il peut être relancé sans créer de doublons.

Pour remplacer l'illustration d'un plat ou d'une formule par une vraie photo (JPEG, PNG ou WebP ;
convertir d'abord une photo HEIC d'iPhone) :

```bash
pnpm --filter @traiteur/api catalog:set-photo --traiteur dar-diafa --dish pastilla-poulet --file ./photos/pastilla.jpg
pnpm --filter @traiteur/api catalog:set-photo --traiteur dar-diafa --package formule-mariage-prestige --file ./photos/mariage.jpg
```

L'identifiant est le slug du plat ou de la formule (visible dans Prisma Studio). L'ancienne photo
est supprimée du stockage 24 h plus tard par la tâche de nettoyage.

## Back-office web

http://localhost:3001/admin — se connecter avec `0600000002` / `Password123!` (gérant).

- **Connexion** par mot de passe ou par code SMS (le code s'affiche dans les logs de l'API en
  développement), mot de passe oublié.
- **Français / arabe** (bouton en haut de l'écran) : toute l'interface passe en arabe et en
  miroir (RTL). Chiffres occidentaux, montants au format marocain (`1.250,00 MAD` /
  `1.250,00 د.م.`), dates `JJ/MM/AAAA` dans le fuseau du traiteur.
- **Menu** filtré selon les permissions de `/auth/me` ; Commandes, Calendrier, Clients,
  Personnel et Paramètres affichent « Bientôt disponible ».
- **Catalogue** (`catalog.read` pour consulter, `catalog.write` pour modifier) :
  - plats : recherche, filtres catégorie et disponibilité, pagination, photo, allergènes, prix
    saisi en HT ou TTC selon le traiteur avec l'autre montant affiché en direct ;
  - formules : composition (plats et quantités par personne), invités min / max, prix par
    personne et valeur indicative des plats au détail calculée en direct ;
  - catégories : ordre par glisser-déposer (souris, doigt ou clavier : Espace puis flèches) ;
  - services : prix et unité de tarification ;
  - bouton **Dupliquer** (plats et formules, composition comprise) ;
  - un élément déjà utilisé dans une commande ou un devis ne peut pas être supprimé, seulement
    archivé ; chaque modification est inscrite au journal d'audit ;
  - alerte avant de quitter un formulaire modifié et non enregistré.

**Session** : le jeton d'accès reste en mémoire (jamais dans `localStorage`) ; le refresh token
est dans un cookie `httpOnly; Secure; SameSite=Strict` limité à `/api/session`, posé par les
routes Next (`apps/web/src/app/api/session`) qui relaient l'API. Le jeton d'accès est renouvelé
automatiquement une minute avant son expiration. Les routes de session vérifient l'origine de la
requête et transmettent l'IP du navigateur uniquement si elle provient d'un proxy de confiance
(`WEB_TRUSTED_PROXY_HOPS`, voir [IP réelle des clients](#ip-réelle-des-clients)).

**Photos** : JPEG, PNG, WebP ou HEIC/HEIF (iPhone). Le navigateur convertit le HEIC (bibliothèque
`heic-to`, licence LGPL, chargée seulement si nécessaire), applique l'orientation EXIF, réduit la
photo (2560 px max) et la réencode en JPEG, ce qui supprime les métadonnées (position GPS
comprise). Elle est envoyée directement au stockage par URL présignée (type et taille signés,
5 Mo max), puis l'API vérifie le contenu réel du fichier et produit deux variantes WebP (1200 et
400 px) sans métadonnées. Une photo jamais rattachée, ou remplacée, est supprimée après 24 h par
une tâche BullMQ horaire (`media-orphans-cleanup`).

## Tester l'authentification

Toutes les routes sont sous `/api/v1/auth`. Le détail est dans Swagger.

| Route                  | Rôle                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `POST /login`          | Téléphone (tout format marocain) ou email + mot de passe         |
| `POST /otp/request`    | Envoi d'un code SMS : `LOGIN`, `SIGNUP` ou `PASSWORD_RESET`      |
| `POST /otp/verify`     | Connexion par code ; crée un compte sans mot de passe si inconnu |
| `POST /register`       | Inscription avec mot de passe (exige un code `SIGNUP`)           |
| `POST /password/reset` | Nouveau mot de passe après code `PASSWORD_RESET`                 |
| `POST /refresh`        | Rotation du refresh token                                        |
| `POST /logout`         | Révocation de la session                                         |
| `GET /me`              | Utilisateur, contexte traiteur et permissions effectives         |

```bash
# Connexion d'un employé
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"traiteurSlug":"dar-diafa","identifier":"0600000003","password":"Password123!"}'

# Profil et permissions (remplacer <ACCESS_TOKEN>)
curl http://localhost:3000/api/v1/auth/me -H 'Authorization: Bearer <ACCESS_TOKEN>'

# Code SMS : en développement, le SMS est simulé et le code s'affiche dans les logs de l'API
curl -X POST http://localhost:3000/api/v1/auth/otp/request \
  -H 'Content-Type: application/json' -d '{"phone":"0661223344","purpose":"LOGIN"}'
curl -X POST http://localhost:3000/api/v1/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"traiteurSlug":"dar-diafa","phone":"0661223344","code":"123456","firstName":"Nadia","lastName":"Idrissi"}'
```

Les erreurs ont un format stable : `{ "code": "INVALID_CREDENTIALS", "message": "…" }`.
Les applications traduisent à partir du `code`.

## Structure du monorepo

```
apps/
  api/             NestJS 12 · Prisma 7 · PostgreSQL · Redis · BullMQ · Swagger
  web/             Next.js 16 (App Router) · Tailwind 4 · TanStack Query
  mobile-client/   Expo 57 · Expo Router — application client
  mobile-staff/    Expo 57 · Expo Router — application personnel et livreurs
packages/
  shared/          Types, enums, schémas Zod, calculs monétaires, permissions (API + web + mobile)
  mobile-ui/       Thème, composants et client API communs aux deux applications Expo
  config/          Configurations TypeScript, ESLint et Prettier partagées
docker/            Script d'initialisation PostgreSQL
.github/workflows/ CI GitHub Actions
```

Organisation de l'API (`apps/api/src`) : un module par domaine.

| Dossier      | Contenu                                                               |
| ------------ | --------------------------------------------------------------------- |
| `config/`    | Validation Zod des variables d'environnement                          |
| `prisma/`    | Client Prisma (pilote PostgreSQL natif `adapter-pg`)                  |
| `redis/`     | Connexion Redis (cache des permissions et des fonctionnalités)        |
| `queue/`     | BullMQ (files `notifications` et `media`)                             |
| `storage/`   | Stockage S3 (URL présignées, traitement des images avec sharp)        |
| `catalog/`   | Catégories, plats, formules, services, photos (`/api/v1/catalog`)     |
| `auth/`      | Inscription, connexion, OTP SMS, JWT, refresh tokens                  |
| `access/`    | Permissions, feature flags et les 5 guards globaux                    |
| `sequences/` | Numérotation continue des documents                                   |
| `documents/` | Lignes de commande et de devis (seul point d’écriture, totaux inclus) |
| `audit/`     | Journal d'audit (authentification, catalogue)                         |

## Choix d'architecture

### Multi-tenant

- **Identité globale** : un `User` (téléphone unique) peut être client de plusieurs traiteurs.
- **Membership** `(userId, traiteurId, role)` pour tous les rôles, y compris `CLIENT`. Les données
  propres à un traiteur (adresses, notes internes, historique) sont rattachées au Membership,
  jamais partagées entre traiteurs.
- Le JWT contient le traiteur actif. **Le `traiteurId` vient toujours du jeton, jamais du client.**
- **Isolation garantie par la base** : toutes les relations entre tables métier utilisent une clé
  étrangère composite `(id, traiteurId)`. PostgreSQL refuse qu'une commande du traiteur A
  référence un client ou un plat du traiteur B. Pour les relations facultatives, la migration
  utilise `ON DELETE SET NULL ("colonne")` (PostgreSQL 15+), qui vide la référence sans toucher
  au `traiteurId`.

### Guards (dans l'ordre, sur toutes les routes sauf `@Public()`)

1. `JwtAuthGuard` : vérifie le jeton d'accès.
2. `TenantGuard` : revérifie en base le Membership (actif, même rôle), le compte et le traiteur
   à chaque requête. Une suspension prend effet immédiatement. Un `:traiteurId` de route doit
   correspondre à celui du jeton.
3. `RolesGuard` : `@Roles('ADMIN_TRAITEUR')`.
4. `PermissionsGuard` : `@RequirePermissions('orders.read')`.
5. `FeatureGuard` : `@RequireFeature('quotes')`.

Le `SUPER_ADMIN` passe les contrôles de rôle et de permission.

### Permissions (hybrides, stockées en base)

- **Matrice par défaut** : `RolePermission` avec `traiteurId = null`, gérée par le SUPER_ADMIN.
- **Surcharges du traiteur** : `RolePermission` avec `traiteurId` renseigné, prioritaires, qui
  peuvent accorder (`granted = true`) ou retirer (`granted = false`) un droit.
- **Permissions critiques** (`isTenantEditable = false` : facturation, abonnement, audit…) :
  les surcharges du traiteur sont ignorées.
- Résultat mis en cache dans Redis (5 min). Si Redis est indisponible, lecture directe en base.
- Le catalogue des clés est dans `packages/shared/src/access/permissions.ts`. Il sert au seed et
  au typage ; à l'exécution, seuls les droits en base comptent.

### Offres et feature flags

`Traiteur.plan` (BASIQUE / PRO / PREMIUM) initialise les `FeatureFlag` du traiteur
(`packages/shared/src/access/features.ts`). Chaque flag reste ensuite modifiable en base.

### Montants et TVA

- Montants **entiers en centimes**, jamais de nombre à virgule. Taux en points de base
  (`2000` = 20 %).
- **Catalogue** : chaque prix est stocké en HT et en TTC. `Traiteur.priceEntryMode` (`TTC` par
  défaut) indique lequel fait foi : le prix saisi est conservé tel quel, l'autre est dérivé.
- **Documents** (commande, devis, facture) : le mode de prix est **figé à la création** et
  recopié sur chaque ligne. Si le traiteur change de mode, les anciens documents ne bougent pas.
- **Calcul d'une ligne**, arrondi au centime (au plus proche, demi s'éloignant de zéro) :

  | Mode | Ce qui fait foi                             | Calcul                                                                 |
  | ---- | ------------------------------------------- | ---------------------------------------------------------------------- |
  | TTC  | `totalTtc = PU TTC × quantité − remise TTC` | `totalHt = arrondi(totalTtc / (1 + taux))`, `TVA = totalTtc − totalHt` |
  | HT   | `totalHt = PU HT × quantité − remise HT`    | `TVA = arrondi(totalHt × taux)`, `totalTtc = totalHt + TVA`            |

  Dans les deux cas, HT + TVA = TTC exactement, et le montant saisi est restitué au centime :
  250 MAD TTC × 120 invités = 30 000,00 MAD, à tous les taux (7, 10, 14, 20 %).

- **Totaux** = somme des lignes, jamais recalculés depuis un total. Les factures portent aussi le
  **récapitulatif de TVA par taux** (`taxBreakdown` : base HT, taux, montant).
- Traiteur non assujetti (`isVatRegistered = false`) : taux 0.
- Toute la logique est dans `packages/shared/src/money/money.ts`, couverte par des tests.
- La base vérifie elle-même ces règles : `CHECK` sur chaque ligne selon son mode, mode de la
  ligne égal à celui du document (clé composite), mode figé (trigger), totaux des commandes et
  devis égaux à la somme des lignes et récapitulatif de TVA des factures exact (vérifications en
  fin de transaction).

### Lignes de commande et de devis

`DocumentLinesService` (`apps/api/src/documents`) est le **seul** point d'entrée pour ajouter,
modifier ou supprimer une ligne de commande ou de devis. Chaque opération, dans une seule
transaction :

1. verrouille le document (`SELECT … FOR UPDATE`) : deux modifications simultanées d'un même
   document sont exécutées l'une après l'autre ;
2. calcule les lignes dans le mode de prix figé du document ;
3. écrit les lignes ;
4. recalcule les totaux du document comme somme de ses lignes.

En dernier rempart, la base vérifie au **COMMIT** que les totaux égalent la somme des lignes :
`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` sur `Order`, `OrderItem`, `Quote` et
`QuoteLine`. Les états intermédiaires d'une transaction sont donc permis, pas un état final
incohérent.

Une règle ESLint (`no-restricted-syntax`, `apps/api/eslint.config.mjs`) interdit toute écriture
dans `OrderItem` ou `QuoteLine` ailleurs que dans `src/documents/document-lines.ts`, qu'elle
soit directe (`tx.orderItem.create`) ou imbriquée (`order.update({ data: { items: … } })`).
Les lectures restent libres. Le test `document-lines.lint.spec.ts` vérifie que la règle détecte
bien chaque forme de contournement. Seuls les tests d'intégration, qui éprouvent les contraintes
de la base, en sont exemptés.

### Numérotation des documents

`CMD-2026-00001`, `DEV-…`, `FAC-…`, `AV-…` : continue, **par traiteur, par type et par année**
(année dans le fuseau du traiteur), **sans trou**.

`nextDocumentNumber(tx, …)` utilise `INSERT … ON CONFLICT DO UPDATE … RETURNING` sur
`DocumentSequence` : la ligne du compteur reste verrouillée jusqu'à la fin de la transaction.
Elle **doit** être appelée dans la même transaction que la création du document ; si celle-ci
échoue, l'incrément est annulé.

### Factures et avoirs

- **Immuables**, garanti par des triggers PostgreSQL : ni modification (sauf `pdfUrl`), ni
  suppression, ni ajout de ligne après émission.
- Vérification différée en fin de transaction : au moins une ligne, totaux égaux à la somme des
  lignes.
- Correction par **avoir** (`type = CREDIT_NOTE`, montants négatifs) qui référence
  obligatoirement une facture.
- Snapshot des informations légales du traiteur (ICE, RC, IF, RIB…) et du client sur chaque
  facture. Les lignes de facture n'ont aucun lien vers le catalogue.

### Authentification

- Mots de passe : **Argon2id** (paramètres OWASP). `passwordHash` facultatif : un compte peut
  n'utiliser que les codes SMS.
- Access token JWT HS256 (15 min) ; refresh token opaque de 256 bits stocké haché (30 jours),
  **à usage unique avec rotation**. Le rejeu d'un jeton déjà utilisé révoque toute la session.
- Codes SMS : 6 chiffres, seul un HMAC est stocké (lié au numéro et à l'usage), 5 minutes de
  validité, 5 tentatives. Un code n'est consommé que si l'opération peut aboutir (un compte déjà
  existant à l'inscription, un profil manquant à la connexion le laissent valide).
- L'inscription par mot de passe exige un code SMS : impossible de créer un compte au nom du
  numéro d'un tiers.
- Réponses identiques que le compte existe ou non (pas d'énumération des comptes).
- Fournisseur SMS simulé (`SMS_PROVIDER=console`) en développement, **interdit en production**
  par la validation des variables d'environnement.

### Protections contre les abus

| Menace                     | Protection                                                             | Réglage                                           |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| SMS pumping                | 60 s entre deux codes, 5 codes / heure / numéro                        | `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_PER_HOUR` |
|                            | 20 demandes / 24 h / adresse IP, tous numéros confondus                | `OTP_MAX_PER_IP_PER_DAY`                          |
|                            | Plafond global de SMS envoyés sur 24 h                                 | `SMS_DAILY_GLOBAL_LIMIT` (2000)                   |
|                            | SMS envoyés seulement aux indicatifs autorisés (Maroc par défaut)      | `SMS_ALLOWED_COUNTRY_CODES` (`212`)               |
| Force brute (mot de passe) | Verrouillage progressif du compte après 5 échecs : 1, 5, 15, 60 min…   | `LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES`     |
| Rafales de requêtes        | Limiteur de débit par IP (20 à 5 requêtes / min selon la route d'auth) | compteurs dans Redis                              |

- **Numéros hors indicatifs autorisés** : le compte reste possible et la réponse est identique,
  mais aucun SMS n'est envoyé. Ces numéros ne peuvent donc pas utiliser les codes SMS, ni
  s'inscrire eux-mêmes : leur compte doit être créé autrement (par le traiteur, plus tard).
- **Verrouillage** : un compte verrouillé refuse même le bon mot de passe. La réponse
  (`INVALID_CREDENTIALS`, même message, même durée grâce à une vérification Argon2 factice) est
  identique pour un mot de passe faux, un compte verrouillé ou un compte inexistant. Les
  tentatives faites pendant le verrouillage ne l'allongent pas. Le compteur repart à zéro après
  une connexion réussie (mot de passe ou code SMS) ou une réinitialisation du mot de passe.
- **Journal d'audit** : `auth.login_failed`, `auth.account_locked`, `auth.login_blocked` et
  `auth.password_reset`, avec l'IP et le user-agent. Chaque plafond atteint (SMS, IP, compte)
  est aussi journalisé en `warn`.
- **Limiteur de débit** : compteurs dans Redis (script Lua atomique), partagés entre toutes les
  instances de l'API et conservés après un redémarrage. Si Redis est indisponible, les requêtes
  passent (journalisé) : les protections critiques ci-dessus reposent sur PostgreSQL.
- **IP réelle derrière un proxy** : voir ci-dessous.

### IP réelle des clients

Les quotas par IP (codes SMS, limiteur de débit) et le journal d'audit reposent sur l'IP du
navigateur. L'en-tête `X-Forwarded-For` est une liste `client, proxy1, proxy2…` où chaque proxy
**ajoute à droite** l'adresse qu'il voit : seules les entrées ajoutées par nos propres proxys
sont fiables, tout ce qui est à leur gauche peut être écrit par le client.

Deux réglages, à faire correspondre au déploiement :

- **`WEB_TRUSTED_PROXY_HOPS`** (back-office Next, routes `/api/session`) : nombre de proxys de
  confiance devant Next. Avec `N`, l'IP retenue est la N-ième adresse de `X-Forwarded-For` **en
  partant de la droite**, transmise seule à l'API. Avec `0`, `X-Forwarded-For` et `X-Real-IP`
  reçus sont ignorés et aucune IP n'est transmise : l'API voit alors tous les navigateurs avec
  l'adresse du serveur Next (Next ne donne pas accès à l'adresse du socket aux routes). Le
  back-office avertit au démarrage si cette valeur vaut `0` en production.
- **`TRUST_PROXY`** (API) : adresses de confiance pour Express, qui lit `X-Forwarded-For` de la
  droite vers la gauche et s'arrête à la première adresse non fiable. Il doit couvrir les
  proxys devant l'API **et le serveur Next** (qui relaie l'IP du navigateur).

| Déploiement                                      | `WEB_TRUSTED_PROXY_HOPS` | `TRUST_PROXY` (API)                                    |
| ------------------------------------------------ | ------------------------ | ------------------------------------------------------ |
| Développement                                    | `0`                      | `loopback`                                             |
| Nginx devant Next et l'API (même serveur)        | `1`                      | `loopback`                                             |
| Nginx, Next et API sur des machines différentes  | `1`                      | adresses de Nginx et de Next, ex. `10.0.0.5,10.0.0.6`  |
| Cloudflare → Nginx, module `real_ip` (conseillé) | `1`                      | comme ci-dessus                                        |
| Cloudflare → Nginx, sans `real_ip`               | `2`                      | adresses de Nginx et de Next + plages IP de Cloudflare |

Configuration Nginx (identique pour le site et l'API) :

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;   # 3000 pour l'API
    proxy_set_header Host $host;        # comparé à l'en-tête Origin (protection CSRF)
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # ajoute, ne remplace pas
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Derrière **Cloudflare**, la solution conseillée est le module `real_ip` de Nginx : l'adresse
transmise par Cloudflare n'est acceptée que si la connexion vient de Cloudflare, et un accès
direct à Nginx (qui contourne Cloudflare) garde l'adresse réelle de l'attaquant.

```nginx
# Plages publiées sur https://www.cloudflare.com/ips/ (une ligne par plage, à tenir à jour)
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 2400:cb00::/32;
real_ip_header CF-Connecting-IP;
```

Sans `real_ip` (`WEB_TRUSTED_PROXY_HOPS=2`), Nginx **doit refuser** toute connexion qui ne
vient pas de Cloudflare (pare-feu ou `allow` / `deny`) : sinon un client qui joint Nginx
directement choisit l'adresse placée en deuxième position.

Dans tous les cas, `API_INTERNAL_URL` doit joindre l'API **directement** (réseau interne ou
Nginx local), jamais en repassant par Cloudflare, et `NEXT_PUBLIC_API_URL` passe par le même
proxy que le site. Ne faites jamais confiance à une adresse qui n'est pas un proxy.

### SQL hors Prisma

Certaines garanties ne s'expriment pas dans le schéma Prisma et sont écrites à la main dans
les migrations : contraintes `CHECK`, index `NULLS NOT DISTINCT`, `ON DELETE SET NULL (colonne)`
et triggers (factures, mode de prix, totaux). **`pnpm --filter @traiteur/api db:check-drift`** vérifie (en CI aussi)
que Prisma ne cherche pas à les annuler.

Pour modifier le schéma :

```bash
cd apps/api
pnpm exec prisma migrate dev --create-only --name ma_modification
# si la migration ajoute une relation facultative entre tables métier :
pnpm db:patch-set-null prisma/migrations/<dossier>/migration.sql
pnpm db:migrate        # applique la migration
pnpm db:generate       # Prisma 7 ne régénère plus le client automatiquement
pnpm db:check-drift    # doit répondre « No difference detected »
```

## Tests et qualité

```bash
pnpm lint          # ESLint (analyse typée, "any" interdit)
pnpm typecheck     # TypeScript strict
pnpm test          # tests unitaires (Vitest pour shared et web, Jest pour l'API)
pnpm build         # build de toutes les applications
pnpm format        # Prettier

# Tests d'intégration (PostgreSQL réel, base gestion_traiteurs_test recréée à chaque lancement)
pnpm --filter @traiteur/api test:int

# Parcours e2e du back-office (Playwright) : connexion, puis plat avec photo et formule.
# Docker démarré et base seedée ; l'API et le web sont lancés s'ils ne tournent pas déjà.
pnpm --filter @traiteur/web exec playwright install chromium   # une seule fois
pnpm --filter @traiteur/web test:e2e
```

Les tests d'intégration couvrent la numérotation sous 50 transactions simultanées, l'absence de
trou après un échec, l'isolation entre traiteurs imposée par la base, les contraintes `CHECK`
et l'immuabilité des factures, ainsi que l'API du catalogue (isolation entre traiteurs,
permissions, prix HT/TTC, archivage, audit, photos). Par sécurité, ils refusent de s'exécuter sur une base dont le nom
ne se termine pas par `_test`.

**CI GitHub Actions** (`.github/workflows/ci.yml`), à chaque push sur `main` et chaque pull
request :

1. Formatage, lint, typecheck, tests unitaires et build.
2. Avec PostgreSQL, Redis et RustFS : migrations, détection d'écart schéma/migrations, seed
   exécuté deux fois (idempotence), tests d'intégration, parcours e2e Playwright.

## Référence des commandes

| Commande                                                  | Effet                                              |
| --------------------------------------------------------- | -------------------------------------------------- |
| `pnpm docker:up` / `pnpm docker:down`                     | Démarre / arrête PostgreSQL, Redis et RustFS       |
| `pnpm db:migrate`                                         | Crée et applique les migrations (développement)    |
| `pnpm db:seed`                                            | Charge les données de démonstration                |
| `pnpm db:reset`                                           | Vide la base, réapplique les migrations et le seed |
| `pnpm db:generate`                                        | Régénère le client Prisma                          |
| `pnpm --filter @traiteur/api db:deploy`                   | Applique les migrations (production / CI)          |
| `pnpm --filter @traiteur/api db:patch-set-null <fichier>` | Réécrit les SET NULL composites d'une migration    |
| `pnpm --filter @traiteur/api db:check-drift`              | Vérifie que schéma et migrations concordent        |
| `pnpm --filter @traiteur/api db:studio`                   | Interface graphique de la base                     |
| `pnpm --filter @traiteur/api catalog:set-photo …`         | Remplace la photo d'un plat ou d'une formule       |
| `pnpm --filter @traiteur/web test:e2e`                    | Parcours Playwright du back-office                 |

## Dépannage

- **`ERR_REQUIRE_CYCLE_MODULE` au lancement de l'API** : Node est trop ancien. Installez Node 24
  LTS (`winget install OpenJS.NodeJS.LTS`), puis `npm i -g pnpm@10`.
- **Port 5433 ou 6379 déjà utilisé** : changez `POSTGRES_PORT` / `REDIS_PORT` dans `.env` à la
  racine et l'URL correspondante dans `apps/api/.env`.
- **La base `gestion_traiteurs_test` n'existe pas** : le script d'initialisation ne s'exécute
  qu'à la création du volume. Créez-la à la main :
  `docker compose exec postgres psql -U traiteur -d gestion_traiteurs -c "CREATE DATABASE gestion_traiteurs_test"`.
- **Avertissement Prisma « onDelete SetNull … referenced field is required »** : attendu, voir
  [SQL hors Prisma](#sql-hors-prisma).
- **« Request has expired » à l'envoi d'une photo** : l'horloge du PC est décalée. L'API
  compense un décalage avec le stockage (avertissement dans ses logs), mais resynchronisez
  l'heure de Windows (Paramètres › Heure et langue › Synchroniser maintenant).
- **Photo non affichée** : vérifiez que RustFS tourne (`docker compose ps`) et que
  `NEXT_PUBLIC_MEDIA_URL` (web) correspond à `S3_PUBLIC_URL` (API).
- **Client Prisma introuvable ou obsolète** : `pnpm db:generate` (Prisma 7 ne le régénère plus
  automatiquement après une migration).

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
5. [Tester l'authentification](#tester-lauthentification)
6. [Structure du monorepo](#structure-du-monorepo)
7. [Choix d'architecture](#choix-darchitecture)
8. [Tests et qualité](#tests-et-qualité)
9. [Référence des commandes](#référence-des-commandes)
10. [Dépannage](#dépannage)

---

## Prérequis

| Outil          | Version                | Remarque                                              |
| -------------- | ---------------------- | ----------------------------------------------------- |
| Node.js        | **24 LTS** (ou 22.23+) | Node 22.13 et antérieurs font planter le CLI NestJS   |
| pnpm           | 10.x                   | `npm i -g pnpm@10`                                    |
| Docker Desktop | récent                 | Pour PostgreSQL 17 et Redis 7                         |
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
# 3. PostgreSQL + Redis
pnpm docker:up

# 4. Base de données : migrations puis données de démonstration
pnpm db:migrate
pnpm db:seed
```

PostgreSQL est exposé sur le port **5433** (et non 5432) pour ne pas entrer en conflit avec une
installation locale. Au premier démarrage, Docker crée aussi la base `gestion_traiteurs_test`
utilisée par les tests d'intégration.

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
| Web (Next.js)     | http://localhost:3001                                    |
| Mobile client     | `pnpm --filter @traiteur/mobile-client dev` puis Expo Go |
| Mobile équipe     | `pnpm --filter @traiteur/mobile-staff dev` puis Expo Go  |
| Prisma Studio     | `pnpm --filter @traiteur/api db:studio`                  |

Depuis un téléphone physique, remplacez `localhost` par l'adresse IP locale de votre PC dans
`EXPO_PUBLIC_API_URL`.

## Comptes de démonstration

Le seed crée le traiteur **Dar Diafa Traiteur** (slug `dar-diafa`, offre PRO, prix saisis TTC),
un catalogue marocain bilingue (12 plats, 2 formules, 3 services), une commande de fiançailles
avec devis, facture, acompte et équipe affectée.

Mot de passe commun : **`Password123!`**

| Rôle           | Téléphone     | Email                           |
| -------------- | ------------- | ------------------------------- |
| SUPER_ADMIN    | +212600000001 | superadmin@gestion-traiteurs.ma |
| ADMIN_TRAITEUR | +212600000002 | admin@dar-diafa.ma              |
| EMPLOYE        | +212600000003 | employe@dar-diafa.ma            |
| LIVREUR        | +212600000004 | livreur@dar-diafa.ma            |
| CLIENT         | +212600000005 | client@exemple.ma               |

Le seed est **idempotent** : il peut être relancé sans créer de doublons.

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
| `queue/`     | BullMQ (file `notifications`, prête pour les traitements asynchrones) |
| `auth/`      | Inscription, connexion, OTP SMS, JWT, refresh tokens                  |
| `access/`    | Permissions, feature flags et les 5 guards globaux                    |
| `sequences/` | Numérotation continue des documents                                   |
| `audit/`     | Journal d'audit (service prêt, pas encore branché)                    |

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
- Prix **stockés HT**. `Traiteur.priceEntryMode` (`TTC` par défaut) indique comment le traiteur
  saisit ses prix ; un prix saisi TTC est converti en HT à l'enregistrement.
- TVA calculée et **arrondie au centime par ligne** (au plus proche, demi s'éloignant de zéro) ;
  les totaux sont la somme des lignes. Ventilation par taux pour les factures.
- Traiteur non assujetti (`isVatRegistered = false`) : taux 0.
- Toute la logique est dans `packages/shared/src/money/money.ts`, couverte par des tests.
- Des contraintes `CHECK` en base vérifient la cohérence arithmétique de chaque ligne.

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
  validité, 5 tentatives, 60 s entre deux envois, 5 codes par heure et par numéro.
- L'inscription par mot de passe exige un code SMS : impossible de créer un compte au nom du
  numéro d'un tiers.
- Réponses identiques que le compte existe ou non (pas d'énumération des comptes).
- Limitation de débit par IP sur les routes d'authentification.
- Fournisseur SMS simulé (`SMS_PROVIDER=console`) en développement, **interdit en production**
  par la validation des variables d'environnement.

### SQL hors Prisma

Certaines garanties ne s'expriment pas dans le schéma Prisma et sont écrites à la main dans
les migrations : contraintes `CHECK`, index `NULLS NOT DISTINCT`, `ON DELETE SET NULL (colonne)`
et triggers des factures. **`pnpm --filter @traiteur/api db:check-drift`** vérifie (en CI aussi)
que Prisma ne cherche pas à les annuler.

Pour modifier le schéma : `pnpm db:migrate` génère une migration ; si elle touche une
relation facultative entre tables métier, réécrivez son `ON DELETE SET NULL` en
`ON DELETE SET NULL ("colonne")` avant de l'appliquer (`prisma migrate dev --create-only`).

## Tests et qualité

```bash
pnpm lint          # ESLint (analyse typée, "any" interdit)
pnpm typecheck     # TypeScript strict
pnpm test          # tests unitaires (Vitest pour shared, Jest pour l'API)
pnpm build         # build de toutes les applications
pnpm format        # Prettier

# Tests d'intégration (PostgreSQL réel, base gestion_traiteurs_test recréée à chaque lancement)
pnpm --filter @traiteur/api test:int
```

Les tests d'intégration couvrent la numérotation sous 50 transactions simultanées, l'absence de
trou après un échec, l'isolation entre traiteurs imposée par la base, les contraintes `CHECK`
et l'immuabilité des factures. Par sécurité, ils refusent de s'exécuter sur une base dont le nom
ne se termine pas par `_test`.

**CI GitHub Actions** (`.github/workflows/ci.yml`), à chaque push sur `main` et chaque pull
request :

1. Formatage, lint, typecheck, tests unitaires et build.
2. Avec PostgreSQL et Redis : migrations, détection d'écart schéma/migrations, seed exécuté
   deux fois (idempotence), tests d'intégration.

## Référence des commandes

| Commande                                     | Effet                                              |
| -------------------------------------------- | -------------------------------------------------- |
| `pnpm docker:up` / `pnpm docker:down`        | Démarre / arrête PostgreSQL et Redis               |
| `pnpm db:migrate`                            | Crée et applique les migrations (développement)    |
| `pnpm db:seed`                               | Charge les données de démonstration                |
| `pnpm db:reset`                              | Vide la base, réapplique les migrations et le seed |
| `pnpm db:generate`                           | Régénère le client Prisma                          |
| `pnpm --filter @traiteur/api db:deploy`      | Applique les migrations (production / CI)          |
| `pnpm --filter @traiteur/api db:check-drift` | Vérifie que schéma et migrations concordent        |
| `pnpm --filter @traiteur/api db:studio`      | Interface graphique de la base                     |

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
- **Client Prisma introuvable ou obsolète** : `pnpm db:generate` (Prisma 7 ne le régénère plus
  automatiquement après une migration).

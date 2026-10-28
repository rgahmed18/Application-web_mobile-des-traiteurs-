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
11. [Mise en production](#mise-en-production)
12. [Dépannage](#dépannage)

---

## Prérequis

| Outil          | Version          | Remarque                                                    |
| -------------- | ---------------- | ----------------------------------------------------------- |
| Node.js        | **24.21+** (LTS) | Base des fuseaux 2026c : Maroc à UTC+0 depuis le 20/09/2026 |
| pnpm           | 10.x             | `npm i -g pnpm@10`                                          |
| Docker Desktop | récent           | PostgreSQL 17, Redis 7, stockage S3 (RustFS)                |
| Expo Go        | facultatif       | Pour ouvrir les applications mobiles sur un téléphone       |

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

Dans `apps/api/.env`, remplacez `JWT_ACCESS_SECRET`, `OTP_SECRET` et `TWO_FACTOR_ENCRYPTION_KEY`
par trois secrets aléatoires distincts (32 caractères minimum) :

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
`traiteur-secret`). Deux buckets, créés par l'API au démarrage (`S3_AUTO_SETUP=true`) :
`traiteur-media` (photos traitées, lecture publique) et `traiteur-documents` (factures, reçus,
devis, photos de chèques, envois bruts : jamais publics, URL signées). En production :
Cloudflare R2, qui ne connaît pas les règles d'accès par préfixe, d'où deux buckets dont seul
celui des photos a un domaine public. Base existante d'avant la séparation :
`pnpm --filter @traiteur/api storage:split` déplace les documents dans le bon bucket.

## Lancer le projet

```bash
pnpm dev                 # API, worker et back-office web (Turborepo)
pnpm dev:api             # API et worker seuls
pnpm dev:web             # back-office web seul
pnpm dev:mobile-client   # application mobile client (Expo), dans son propre terminal
pnpm dev:mobile-staff    # application mobile équipe et livreurs (Expo), dans son propre terminal
```

Les applications Expo ne sont **pas** lancées par `pnpm dev` : elles ont besoin du terminal
pour elles seules (QR code, raccourcis clavier) et, lancées en parallèle sous Windows, se le
disputent et font tout planter. Ouvrez un terminal par application mobile, `pnpm dev` tournant
dans un autre. Chaque commande construit d'abord les paquets partagés dont l'application
dépend.

L'API et le **worker** sont deux processus du même code (`apps/api`) : l'API sert le HTTP et
ne consomme aucune file ; le worker n'a pas de serveur HTTP et exécute les tâches BullMQ
(reprise des PDF, nettoyage des photos, expiration des devis). En production :
`pnpm --filter @traiteur/api start` et `pnpm --filter @traiteur/api start:worker` (un ou
plusieurs workers ; BullMQ confie chaque tâche à un seul). Sans worker, l'API fonctionne mais
les tâches planifiées attendent dans Redis.
En développement, le worker tourne sur le `dist/` compilé par l'API (`scripts/dev-worker.mjs`,
relancé par Node à chaque recompilation) : un seul compilateur TypeScript en mode watch.

| Application       | URL / commande                          |
| ----------------- | --------------------------------------- |
| API               | http://localhost:3000/api/v1            |
| Swagger (doc API) | http://localhost:3000/docs              |
| Back-office       | http://localhost:3001/admin             |
| Console RustFS    | http://localhost:9001                   |
| Mobile client     | `pnpm dev:mobile-client` puis Expo Go   |
| Mobile équipe     | `pnpm dev:mobile-staff` puis Expo Go    |
| Prisma Studio     | `pnpm --filter @traiteur/api db:studio` |

Depuis un téléphone physique, remplacez `localhost` par l'adresse IP locale de votre PC dans
`EXPO_PUBLIC_API_URL`.

## Comptes de démonstration

Le seed crée le traiteur **Dar Diafa Traiteur** (slug `dar-diafa`, offre PRO, prix saisis TTC),
un catalogue marocain bilingue (6 catégories, 21 plats, 3 formules, 4 services) illustré par des
images générées, 10 clients (dont une cliente au numéro français) et 22 commandes réparties de
mi-septembre à mi-novembre 2026 dans tous les statuts : un jour complet (24/10 : 3 événements pour
une capacité de 3), deux dates bloquées (31/10 et 06/11), des commandes à clôturer et une commande
de fiançailles avec devis, facture, acompte et équipe affectée.

Il ajoute aussi le matériel (6 articles : chaises, tables, nappes, housses, chauffe-plats, arche
florale, avec stock et prix de remplacement), 3 buffets (marocain, sucré, thé au forfait), les
gammes et types d'événement des formules, et 3 commandes qui les utilisent : une **soutenance**
le 12/11, un mariage le 21/11 qui mobilise 250 des 300 chaises, et des fiançailles en attente le
même soir avec 120 chaises (la confirmation signale le manque et demande un motif).

Mot de passe commun : **`Password123!`**

| Rôle           | Téléphone     | Email                           |
| -------------- | ------------- | ------------------------------- |
| SUPER_ADMIN    | +212600000001 | superadmin@gestion-traiteurs.ma |
| ADMIN_TRAITEUR | +212600000002 | admin@dar-diafa.ma              |
| EMPLOYE        | +212600000003 | employe@dar-diafa.ma            |
| LIVREUR        | +212600000004 | livreur@dar-diafa.ma            |
| EQUIPE         | +212600000006 | equipe@dar-diafa.ma             |
| CLIENT         | +212600000005 | client@exemple.ma               |

Le SUPER_ADMIN doit activer la **double authentification** à sa première connexion (QR code à
scanner avec Google Authenticator, Microsoft Authenticator ou Aegis, puis 10 codes de secours à
usage unique affichés une seule fois). Les administrateurs de traiteur peuvent l'activer depuis
« Paramètres › Mon compte ».

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
  miroir (RTL). Chiffres occidentaux ; montants au format unique de `packages/shared`
  (`formatMoney`), identique dans l'interface, la console et les PDF : `1 500,00 MAD` /
  `1 500,00 د.م.` (espace insécable entre les milliers et avant la devise, virgule décimale).
  Exports : XLSX en nombres (affichés selon la langue d'Excel, `# ##0,00` en français), CSV en
  `1500,00` sans séparateur pour rester relu comme un nombre. Dates `JJ/MM/AAAA` dans le fuseau
  du traiteur.
- **Menu** filtré selon les permissions de `/auth/me` ; Personnel affiche « Bientôt disponible ».
- **Paramètres › Documents et paiements** (`settings.manage`) : acompte, solde à J-N, validité
  des devis, conditions FR/AR, TVA des frais d'annulation, numérotation des avoirs, mentions
  légales (ICE, IF, RC, patente, CNSS, capital, RIB) et logo des documents.
- **Tableau de bord** : commandes du jour, à venir sur 7 jours, en attente de confirmation,
  à clôturer (événement passé, commande non clôturée) et « CA des événements du mois »
  (commandes fermes dont l'événement tombe dans le mois, TTC). Chaque carte ouvre la liste filtrée.
- **Clients** (`clients.read`, `clients.write`) : recherche par nom ou téléphone, tri, fiche
  (coordonnées, adresses, notes internes, étiquettes, historique des commandes, total dépensé),
  appel et WhatsApp en un clic. Le traiteur crée un client sans mot de passe (commande prise par
  téléphone, numéro étranger sans SMS) ; un numéro déjà inscrit ailleurs est rattaché sans
  doublon, et la réponse est identique à une création. Les coordonnées affichées sont celles
  saisies par ce traiteur (`Membership`) : jamais celles d'un autre traiteur ni du compte global.
- **Commandes** (`orders.read`, `orders.create`, `orders.write`, `orders.cancel`,
  `orders.edit_confirmed`) : liste filtrée (statut, période, type, référence ou client),
  formulaire guidé (client recherché ou créé à la volée, événement, lieu, prestations — formules,
  plats, buffets, matériel, services, lignes libres — avec remises en montant ou en %, totaux HT /
  TVA par taux / TTC en direct, bouton **Arrondir le total**), fiche avec historique, devis,
  paiements et emplacement Personnel. Changer le nombre d'invités propose d'ajuster les lignes
  « par personne ».
- **Matériel dans les commandes** : chaque ligne de matériel affiche le stock de la période
  (« Reste 80 sur 200 · +60 en attente · manque 10 »). La période d'occupation va du début de
  l'événement moins le délai d'installation à sa fin plus le délai de retour (réglages de
  l'établissement, 12 h et 24 h par défaut, modifiables par commande). Seules les commandes
  fermes (confirmée → livrée) sont déduites ; les commandes en attente sont affichées à part.
  Quand une commande devient ferme (création confirmée, confirmation, modification d'une commande
  ferme), un stock insuffisant renvoie `409 EQUIPMENT_STOCK_CONFLICT` avec le détail ; le
  traiteur peut confirmer quand même avec un motif (`stockOverrideReason`), tracé dans l'audit
  (`equipment.stock_overridden`). Un devis accepté en ligne alors que le matériel manque laisse la
  commande au traiteur (« date à confirmer »), comme une date complète.
- **Calendrier** (`calendar.read`, `calendar.manage`) : vues mois, semaine et liste, commandes
  colorées par statut, charge du jour (`2/3`), dates bloquées hachurées. Un clic sur un jour ouvre
  ses commandes, le blocage de la date et « Nouvelle commande » pré-rempli. Capacité par jour
  réglable depuis le calendrier.
- **Catalogue** (`catalog.read` pour consulter, `catalog.write` pour créer, modifier, archiver
  ou supprimer — réservé à l'administrateur du traiteur et au super-admin, verrouillé dans la
  grille des permissions ; chaque modification du super-admin est tracée avec son rôle) :
  - plats : recherche, filtres catégorie et disponibilité, pagination, photo, allergènes, prix
    saisi en HT ou TTC selon le traiteur avec l'autre montant affiché en direct ;
  - formules : composition (plats et quantités par personne), invités min / max, prix par
    personne et valeur indicative des plats au détail calculée en direct ;
  - catégories : ordre par glisser-déposer (souris, doigt ou clavier : Espace puis flèches) ;
  - buffets : type, gamme, composition en plats du catalogue et en éléments libres FR/AR, prix
    par personne ou forfait, invités minimum ;
  - matériel : catégorie, gamme, photo, prix de location et de remplacement, stock ; disponibilité
    par période (`GET /catalog/equipment/availability?start&end`) ;
  - services : prix et unité de tarification ;
  - listes (`/catalog/lists/event-types`, `/catalog/lists/ranges`) : types d’événement (dont la
    soutenance) et gammes du traiteur, traduits, créés par défaut pour chaque traiteur ; code
    stable référencé par les commandes, ordre par glisser-déposer, archivage d’un élément utilisé ;
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

### Personnel

- **Rôles du personnel** : Administrateur (accès complet), Employé (bureau : commandes, devis,
  clients, calendrier), Équipe (terrain : cuisine, service, extras ; ne voit que ses missions,
  sans aucun prix) et Livreur (ses livraisons seulement, sans prix ; statut de livraison).
- **Invitation** (`staff.manage`) : téléphone, nom, rôle et langue. Un lien d'activation est créé
  (jeton de 256 bits dont seule l'empreinte est conservée, usage unique, valable 7 jours,
  régénérable) : envoyé par SMS si le pays est autorisé (`SMS_ALLOWED_COUNTRY_CODES`), toujours
  affiché une fois à l'administrateur (copie, WhatsApp) pour les numéros étrangers. Le numéro
  d'un client du traiteur ou d'un membre existant est refusé.
- **Activation** `/invitation/<jeton>` (publique, `noindex`, `no-referrer`, débit limité) : le
  nouveau membre choisit son mot de passe ; un compte existant confirme avec son mot de passe
  actuel (le lien ne remplace jamais un mot de passe).
- **Suspension** (motif) : accès refusé dès la requête suivante (le membre est revérifié à
  chaque requête), sessions et invitation révoquées ; réactivation (un membre qui ne s'est
  jamais connecté redevient « invité » avec un nouveau lien). On n'agit pas sur soi-même, seul
  un administrateur nomme, rétrograde ou suspend un administrateur, et le dernier administrateur
  actif ne peut pas être retiré. Un changement de rôle impose une reconnexion.
- **Permissions** (`permissions.manage`, onglet du Personnel) : grille rôles × permissions
  groupée par module, quatre colonnes (Administrateur, Employé, Équipe, Livreur). Une case égale
  à la valeur par défaut supprime la surcharge ; les permissions critiques sont verrouillées ;
  « Rétablir les valeurs par défaut » pour un rôle ou tous. Les permissions des clients restent
  hors de la grille.

### Affectations et missions

- **Fiche commande → Personnel** (`staff.manage`) : affecter un membre avec un rôle sur
  l'événement (chef, cuisinier, serveur, superviseur, chauffeur), des horaires (proposés selon
  le rôle) et une note. Un chevauchement avec une autre mission du membre est refusé avec le
  détail, sauf si le traiteur passe outre (tracé). Commande confirmée, en préparation ou en
  livraison seulement. Informations de service (`orders.write`) : contact sur place (le client
  par défaut) et notes de service — jamais montrés au client. Le matériel vient des lignes de
  matériel de la commande (l'ancien champ libre a été versé dans les notes de service).
- **Planning** (Personnel → Planning) : semaine par personne, missions colorées par statut,
  chevauchements signalés.
- **Mes missions** (`assignments.read_own`, page d'accueil de l'équipe et des livreurs) :
  uniquement ses missions, construites champ par champ sans aucun prix, total, paiement ni note
  interne (vérifié par les tests sur toute la réponse). Date et horaires, lieu avec Google Maps
  et itinéraire, contact sur place (appel, WhatsApp), contenu et quantités dans sa langue,
  matériel, notes, équipe. Actions : confirmer, « Je ne peux pas » (motif), mission terminée ;
  le chauffeur fait passer la commande « En livraison » puis « Livrée ».
- **Alertes** : une mission refusée, ou non confirmée moins de 48 h avant son début, s'affiche
  sur le tableau de bord et en badge sur la commande.
- **Missions terminées** : après le délai réglé (`Traiteur.missionRedactionDays`, 7 jours par
  défaut, sans masquage si vide), l'adresse, le contact sur place et les téléphones sont masqués
  (il reste la date, la référence et la ville).
- **Bons PDF** (Typst, sans prix) : bon de préparation par événement (fiche commande, mission
  d'un cuisinier) ou par jour (calendrier), quantités totales par plat regroupées par catégorie,
  formules et buffets décomposés en plats (éléments libres des buffets compris), matériel à
  sortir récapitulé à part ; bon de livraison dans la langue du client (adresse, contact,
  contenu, matériel loué, notes, signature du client à la réception). Générés à la demande.
- Le livreur n'a plus accès au catalogue par défaut (prix) ; le traiteur peut le lui rendre.

### Paiements

- **Échéancier** (`packages/shared/src/payments/payment-schedule.ts`, testé) : acompte = total TTC
  × pourcentage du traiteur (30 % par défaut), **arrondi au dirham**, figé à la confirmation et
  ajustable ; dû à la confirmation. Solde dû N jours avant l'événement (J-7 par défaut). Si
  l'événement est trop proche, une seule échéance : la totalité. Les paiements couvrent l'acompte
  puis le solde ; une échéance passée non couverte est **en retard** (fuseau du traiteur).
- **Encaissements manuels** (espèces, virement, chèque, carte sur TPE), avec référence et date
  (jamais future). Chaque encaissement reçoit un **reçu numéroté** (`REC-2026-00001`, séquence
  continue par traiteur et par année) dont le PDF est figé et stocké.
- **Garanties de la base** : payé net (encaissements − remboursements) toujours compris entre 0
  et le total TTC, vérifié en fin de transaction ; un encaissement ne se modifie ni ne se
  supprime : une erreur s'annule (motif obligatoire), le reçu est alors marqué « ANNULÉ ».
- Le total d'une commande ne peut pas descendre sous le montant déjà payé.
- **Annulation d'une commande payée** : le traiteur choisit le montant remboursé ; le reste est
  enregistré comme **frais d'annulation**.
- Tableau de bord : « Encaissé ce mois » et « Impayés » ; liste des commandes filtrable
  (reste à payer, en retard).
- **Encaissement à la livraison (caisse livreurs)** : sur l'affectation d'un chauffeur ou d'un
  superviseur, l'administrateur règle un montant à encaisser et son mode (espèces ou chèque). Le
  livreur le voit sur cette mission seulement (seul montant jamais montré à l'équipe) et déclare
  « Encaissé » (`deliveries.collect_cash`) : montant reçu, mode, n° et photo du chèque
  facultative (réencodée en JPEG, métadonnées et position GPS supprimées, stockage privé). La
  déclaration crée un paiement **en attente de remise** (`status = PENDING`) qui ne compte nulle
  part. Page **Caisse livreurs** (`payments.record`) : montants déclarés non remis, par livreur ;
  « Argent reçu » le fait compter et lui attribue son reçu `REC-…` ; « Refuser » (motif) l'annule
  et le livreur peut déclarer à nouveau. Garanties de la base : une seule déclaration vivante par
  affectation, et la remise (en attente → réussi, une fois) est la seule modification permise
  d'un encaissement en plus de l'annulation ; une affectation avec un encaissement déclaré ne se
  supprime pas et son montant ne change plus.
- Paiement en ligne (CMI) : prévu (champs `provider` / `providerRef`), pas encore implémenté.

### Devis

- **Versions** : un devis est préparé depuis les lignes de la commande (`quotes.manage`). Ses
  versions partagent la même référence (`DEV-2026-00012` v1, v2…) ; un brouillon se met à jour
  avec les lignes actuelles, s'aperçoit en PDF (filigrane « BROUILLON ») et se règle (validité,
  15 jours par défaut ; langue du client, français ou arabe ; remarques).
- **Envoi** : lignes figées par la base (trigger `QuoteLine_frozen`), informations affichées
  figées (`Quote.snapshot`), **PDF généré une fois et stocké** (empreinte SHA-256, version du
  gabarit), versions précédentes « Remplacé ». La commande en attente passe « Devis envoyé ».
- **Lien sécurisé** : jeton aléatoire de 256 bits, affiché une seule fois ; seule son empreinte
  SHA-256 est conservée. Il expire à la fin du dernier jour de validité, peut être désactivé ou
  remplacé. Partage depuis l'appareil du traiteur : WhatsApp (`wa.me`), SMS (`sms:`) ou e-mail
  (`mailto:`), message pré-rédigé dans la langue du devis.
- **Page publique** `/devis/<jeton>` (sans connexion) : détail, PDF, accord ou refus. En-têtes
  `X-Robots-Tag: noindex` et `Referrer-Policy: no-referrer` (le jeton ne fuit vers aucun autre
  site), `Cache-Control: no-store`, débit limité par IP. Jeton inconnu ou désactivé : 404.
- **Accord en ligne** : nom saisi et case « J'accepte » ; heure, IP et navigateur enregistrés. La
  commande est **confirmée** (acompte figé) si la date est libre. Si la date est bloquée ou
  complète, l'accord est enregistré, la commande reste « Devis envoyé » et le client lit « Votre
  accord est enregistré, le traiteur vous confirmera la date » ; une alerte apparaît sur le
  tableau de bord jusqu'à la décision du traiteur.
- **Accord manuel** (`orders.write`) : accord téléphonique, devis papier signé ou autre ; nom de
  la personne, note, scan ou photo facultatif (PDF, JPEG, PNG, WebP, 10 Mo, stockage privé,
  type vérifié sur le contenu). Même effet que l'accord en ligne, tracé dans le journal d'audit.
- **Refus** (motif facultatif) ou **expiration** (vérifiée à chaque lecture et toutes les heures
  par une tâche BullMQ) : la commande revient « En attente » s'il ne reste aucun devis en cours.
- **Lignes de la commande modifiées après l'envoi ou l'accord** : le devis passe « Remplacé »,
  son lien est désactivé, la fiche affiche « un nouveau devis est nécessaire » ; une commande
  confirmée le reste.

### Factures et avoirs (back-office)

- **Émission** depuis la fiche d'une commande confirmée (`invoices.issue`) : **facture totale**,
  ou **facture d'acompte** (acompte de la commande, une ligne par taux de TVA au prorata du TTC
  de chaque taux) puis **facture de solde** (lignes de la commande moins les acomptes facturés,
  repris ligne à ligne : acompte + solde = commande, au centime près et par taux).
- **Date d'émission** = date du jour, imposée par la base (trigger) : jamais antidatée. Numéro
  continu par année. Échéance : à réception pour un acompte, J-7 de l'événement pour une facture
  totale ou de solde (jamais avant le jour d'émission).
- **Avoirs** (`invoices.credit_note`) : avoir total d'une facture, motif obligatoire imprimé.
  À l'**annulation** d'une commande avec remboursement, les factures émises (acompte d'abord)
  sont automatiquement soldées par un avoir du montant remboursé.
- **Frais d'annulation** : le montant conservé et non encore facturé peut être facturé, au taux
  de TVA réglé dans les Paramètres (`cancellationFeeTaxRateBps`, taux par défaut sinon).
- **Numérotation des avoirs** (Paramètres, à faire valider par le comptable) : séquence propre
  `AV-2026-00001` (par défaut) ou série partagée avec les factures (`FAC-…`, un seul compteur).
- **Mentions** : vendeur complet (raison sociale, forme, capital, adresse, ICE, IF, RC et
  tribunal, patente, CNSS, RIB), client et, pour une entreprise, sa raison sociale et son ICE
  (fiche client), lignes HT, récapitulatif de TVA par taux, totaux, « Non assujetti à la TVA »
  le cas échéant, conditions de paiement, pénalités de retard (loi 69-21), montant en lettres.
- **PDF** généré une seule fois à l'émission, stocké en privé avec son empreinte SHA-256 et la
  version du gabarit ; la base refuse de le remplacer.
- **Page Factures** (`/admin/invoices`, `invoices.read`) : recherche (n°, commande, client,
  ICE), période, type ; **export xlsx** (montants numériques, dates réelles) ou **CSV pour Excel**
  (UTF-8 avec BOM, séparateur « ; », virgule décimale), avec base HT et TVA par taux.

### Documents PDF

- Générés avec **Typst** (`@myriaddreamin/typst-ts-node-compiler`) à partir d'un gabarit unique
  (`apps/api/assets/templates/document.typ`) : mise en forme arabe complète (liaison des lettres,
  droite-à-gauche), chiffres occidentaux, rendu **déterministe** (mêmes données → même PDF, octet
  pour octet). Langue du document : celle du client (français ou arabe).
- **Polices embarquées** : IBM Plex Sans Arabic (`apps/api/assets/fonts`), sous licence
  **SIL Open Font License 1.1** (texte complet : `apps/api/assets/fonts/OFL-IBM-Plex.txt`).
  Aucune police propriétaire n'est utilisée.
- **Stockage** : bucket `documents` (privé, sans domaine public), téléchargement par URL signée
  valable 5 minutes ; un test vérifie qu'aucun document n'est lisible par l'URL publique et que
  le bucket public ne contient que des photos traitées (`storage-isolation.int-spec.ts`). Les documents émis (reçus, devis envoyés, factures et avoirs)
  sont figés : empreinte SHA-256 et version du gabarit enregistrées, jamais régénérés.
- **Montants en lettres** (`packages/shared/src/money/amount-words.ts`), en français et en arabe,
  testés sur les cas difficiles (0,50 ; 1 ; 2 ; 11 ; 21 ; 71 ; 80 ; 100 ; 1 000 ; 1 000 000…).

### Paramètres

Page **Paramètres** en onglets (onglet mémorisé dans l'URL), `settings.manage` sauf « Mon compte » :

- **Entreprise** : nom commercial, email, téléphone, ville (`/settings/company`) ; logo et
  mentions légales des documents (raison sociale, ICE, RC, IF, patente, CNSS, adresse du siège).
- **Documents et paiements** : échéancier (acompte, solde), validité des devis, conditions,
  TVA des frais d'annulation, numérotation des avoirs, banque, RIB, pied de facture.
- **Disponibilités** (`/settings/availability`) : capacité par jour, **fermeture hebdomadaire**
  (jours ISO, au moins un jour ouvert, garanti par la base) et délai de masquage des missions
  terminées. Un jour fermé se traite comme une date bloquée : le calendrier l'affiche, une
  commande ferme ou un accord de devis ce jour-là demande un accord explicite (tracé).
- **Mode de prix** (`/settings/pricing`) : saisie HT ou TTC, avec confirmation. S'applique aux
  nouveaux prix et documents ; commandes, devis, factures et reçus existants gardent le mode figé
  à leur création, le catalogue stocke déjà HT et TTC.
- **Mon compte** (`/me/account`, tout utilisateur, aussi depuis le menu de l'avatar) : prénom,
  nom (repris sur sa fiche d'équipe), langue de l'interface ; nouveau mot de passe (l'actuel est
  exigé) qui **ferme toutes les sessions** : reconnexion sur tous les appareils.

Chaque modification est tracée dans le journal d'audit (avant / après).

### Console de la plateforme (super admin)

Espace séparé sous `/platform`, impossible à confondre avec le back-office d'un traiteur : barre
latérale bleu nuit, barre du haut indigo, logo « Console plateforme », badge **SUPER ADMIN**
permanent (français et arabe). Le back-office est en marque blanche : nom et logo du traiteur
dans la barre latérale ; « Gestion Traiteurs » est réservé à la console.

- À la connexion, le super admin arrive **toujours** sur la console (session plateforme, sans
  traiteur) ; il ne voit jamais le back-office d'un traiteur sans y entrer explicitement. Les
  autres comptes n'ont jamais accès à la console.
- Routes `/api/v1/platform/*` : réservées au super admin en session plateforme (`PLATFORM_ONLY`
  pour tout autre rôle et pour un super admin entré chez un traiteur), testées contre chaque rôle.
- **Tableau de bord** : traiteurs actifs, en essai, suspendus ; commandes du mois (tous traiteurs
  confondus) ; abonnements estimés au prix en vigueur des offres ; essais qui se terminent dans
  les 14 jours ; activité par traiteur ; dernières actions de la plateforme. Chiffres agrégés
  uniquement : aucune donnée des clients des traiteurs.
- **Traiteurs** (`/platform/traiteurs`) : recherche, filtre de statut, offre, activité du mois,
  état de l'accès du premier administrateur. **Nouveau traiteur** par formulaire (identité, offre,
  essai de 30 jours par défaut, administrateur) : même logique que la commande `create-traiteur`
  ; l'administrateur reçoit un lien d'activation de 7 jours (SMS si possible, sinon copie ou
  WhatsApp), jamais de mot de passe. **Renvoyer le lien** tant qu'il n'a pas activé son accès
  (l'ancien lien est annulé). Chaque action est tracée (`platform.traiteur_created`,
  `platform.admin_invitation_resent`).
- **Fiche d'un traiteur** (`/platform/traiteurs/<id>`) : changer l'offre (fonctionnalités remises à
  celles de l'offre au choix), activer ou couper une fonctionnalité (effet immédiat : cache vidé),
  prolonger ou raccourcir l'essai, activer l'abonnement avant terme, **suspendre** avec un motif
  (traiteur, équipe et clients sans accès dès la requête suivante, catalogue public masqué)
  puis réactiver ; historique des actions de la plateforme sur ce traiteur.
- **Entrer chez un traiteur** (bouton de la fiche) : motif obligatoire, accès de **2 heures**
  (`PlatformAccess`), session limitée à ce traiteur. Le back-office affiche un bandeau rayé
  ambre impossible à manquer (nom du traiteur, motif, temps restant « expire dans 1 h 52 »,
  **Prolonger** avec un nouveau motif, **Quitter et revenir à la console**), en français et en
  arabe ; le super admin y apparaît toujours comme « Super Admin · plateforme » (avatar SA),
  jamais sous le nom de l'administrateur du traiteur. L'accès est revérifié à chaque requête :
  terminé ou expiré, l'API répond `PLATFORM_ACCESS_ENDED` et le rafraîchissement de session
  ramène à la console (sortie automatique). Entrée, prolongation et sortie sont tracées dans
  l'historique du traiteur (`platform.access_started|extended|ended`), ainsi que **chaque
  modification** faite pendant l'accès (`platform.access_request` : méthode, chemin, statut).
  Routes : `POST /platform/traiteurs/:id/enter`, `POST /platform/access/extend`,
  `POST /platform/access/leave`.
- **Journal d'audit** (`/platform/audit`) : qui a fait quoi, chez quel traiteur, quand, avec
  filtres (auteur parmi les super admins, action, traiteur, période en heure du Maroc). Par
  défaut les actions de la plateforme ; « Toutes les actions » ajoute celles des équipes des
  traiteurs, **sans leur contenu** (ni avant/après) et sans jamais nommer un client (« Nom
  masqué », rôle seul). Seuls le motif des actions de la console et les requêtes faites pendant
  un accès chez un traiteur (méthode, chemin, statut) sont affichés.
- **Permissions par défaut** (`/platform/permissions`) : matrice rôles × permissions de tous les
  traiteurs (administrateur, employé, équipe, livreur, client), chaque case prenant effet tout de
  suite (cache des permissions invalidé). Chaque traiteur ajuste ensuite la sienne, sauf les
  permissions critiques (cadenas). Une case différente de la valeur prévue par le catalogue
  (`packages/shared`) est marquée (`RolePermission.editedAt`, point orange) : la synchronisation
  du catalogue au déploiement (`syncPermissionCatalog`) ne la touche plus et n'ajoute que les
  nouvelles permissions ; remise à la valeur prévue, elle suit de nouveau le catalogue. Chaque
  changement est tracé (`platform.permission_default_changed`).
- **Offres et fonctionnalités** (`/platform/plans`) : prix mensuel de chaque offre modifiable,
  en vigueur tout de suite, historique conservé ; fonctionnalités incluses par offre.
- Prix des offres (`PlatformPlanPrice`, historique conservé) : 400, 850 et 1 500 MAD par mois au
  départ. Période d'essai : 30 jours par défaut (`Traiteur.trialEndsAt`).

### Espaces : le traiteur vient de l'adresse

Une seule application sert toute la plateforme ; **le traiteur est toujours déduit de l'adresse**
par le serveur, jamais choisi par le navigateur :

| Adresse                                | Espace                                               |
| -------------------------------------- | ---------------------------------------------------- |
| `APP_HOST` (ex. `app.exemple.ma`)      | console de la plateforme (super admin)               |
| `<identifiant>.TENANT_BASE_DOMAIN`     | back-office du traiteur (ex. `dar-diafa.exemple.ma`) |
| domaine personnalisé vérifié (Premium) | back-office du traiteur                              |
| toute autre adresse                    | « Espace introuvable » (et aucun certificat)         |

- Résolution par l'API (`GET /public/spaces/resolve?host=`, gardée 30 s) : un traiteur résilié
  n'est plus servi, un traiteur suspendu l'est (la connexion explique l'indisponibilité).
  Sous-domaines réservés : `www`, `api`, `app`, `admin`, `console`, `media`, `staging`…
- **Connexion à l'espace de gestion** (`space: "backoffice"`, posé par le serveur web) : un
  Membership du personnel actif chez **ce** traiteur est exigé ; aucune inscription
  automatique comme client, aucune création de compte. Numéro inconnu, client, membre d'un
  autre traiteur : même réponse (« Ce compte n'a pas accès à l'espace de gestion de Dar
  Diafa »), sans jamais nommer un autre traiteur. Le super admin ne se connecte que sur
  l'adresse de la console (on ne saisit jamais ses identifiants sur l'adresse d'un traiteur).
- Une session ne vaut que pour l'espace de son adresse : le serveur web la révoque sinon (à la
  connexion comme à chaque rafraîchissement).
- Liens envoyés (invitations, devis) : adresse du traiteur (`TENANT_URL_TEMPLATE`, ou son
  domaine personnalisé). Le lien d'activation d'un super admin : la console (`PUBLIC_WEB_URL`).
- Production : `PUBLIC_API_URL=/api/v1`, chaque adresse appelle l'API sur elle-même (Caddy),
  sans origine croisée. Développement : `http://localhost:3001` (console) et
  `http://dar-diafa.localhost:3001` (Chrome, Edge et Firefox résolvent `*.localhost` seuls),
  `CORS_ORIGINS` avec le modèle `http://*.localhost:3001`.
- **Démonstration** sur un PC du réseau local : `TENANT_BASE_DOMAIN=<IP>.nip.io` ; le téléphone
  ouvre `http://dar-diafa.<IP>.nip.io:3001` (nip.io renvoie l'IP contenue dans le nom, il faut
  un accès Internet pour le DNS). Pour le développement seulement, `DEMO_SPACE_SELECTION=true`
  (API et web) ajoute sur la console « ?traiteur=<identifiant> » et une liste de choix ; refusé
  au démarrage si `NODE_ENV=production`, donc jamais avec `next start`.
- Nettoyage des inscriptions client créées par erreur avant cette correction : commande
  `leaked-client-memberships` (docs/deploiement.md).

**Applications mobiles (choix retenu, pas encore codé)** :

- Application des **clients** : une par traiteur (marque blanche), l'identifiant est fixé dans
  sa configuration (`EXPO_PUBLIC_TRAITEUR_SLUG`) ; l'inscription automatique comme client
  reste propre à cet espace (`space` « client »).
- Application du **personnel** : une seule pour tous les traiteurs. Elle saura à quel traiteur
  elle appartient par **le lien d'invitation**, qui contient déjà l'adresse du traiteur
  (`https://dar-diafa.<domaine>/invitation/…` : lien universel ouvert par l'application, qui en
  retient l'identifiant), et, à défaut, par **un choix à la première connexion** parmi les
  traiteurs où le compte fait partie du personnel (route à ajouter : liste des espaces du
  compte après preuve de son identité, sans jamais montrer les traiteurs où il est seulement
  client). La connexion se fait ensuite avec `space: "backoffice"` et cet identifiant ; un
  membre de plusieurs traiteurs change d'espace en se reconnectant.

### Catalogue public (site client)

API en lecture seule, sans connexion, pour le futur site client de chaque traiteur :

- `GET /api/v1/public/traiteurs/:slug/catalog/options` : types d'événement et gammes proposés
  (actifs, dans l'ordre du traiteur), nom du traiteur et devise ;
- `GET /api/v1/public/traiteurs/:slug/catalog?eventType=THESIS&range=PREMIUM` : menus et
  formules (ceux du type demandé et ceux prévus pour tous les événements), buffets et matériel
  de la gamme demandée.

Seuls les éléments actifs et non archivés sont publiés, avec leurs **prix TTC**, leurs photos
(URL publique) et leurs textes FR/AR. Ni stock, ni prix de remplacement, ni prix HT. Un traiteur
inconnu, suspendu ou résilié répond 404. Débit limité à 120 requêtes par minute et par adresse ;
réponses gardées une minute (`Cache-Control: public, max-age=60` et cache Redis) : une
modification du catalogue apparaît sur le site en une minute au plus.

### Cycle de vie d'une commande

Machine à états unique (`packages/shared/src/orders/order-status.ts`), imposée par l'API et
utilisée par l'interface pour n'afficher que les actions permises :

| Transition                                                      | Permission                                   | Remarque                                  |
| --------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| Brouillon → En attente                                          | `orders.write`                               | au moins une prestation                   |
| Brouillon, En attente, Devis envoyé → Confirmée                 | `orders.write`                               | contrôle de disponibilité (forçage tracé) |
| En attente ↔ Devis envoyé                                       | automatique                                  | module Devis (étape suivante)             |
| Confirmée → En attente                                          | `orders.cancel`                              | motif obligatoire                         |
| Confirmée → En préparation                                      | `orders.write`                               |                                           |
| En préparation → En livraison ou Livrée ; En livraison → Livrée | `orders.write` ou `deliveries.update_status` | le livreur fait avancer la livraison      |
| Livrée → Clôturée                                               | `orders.write`                               |                                           |
| Brouillon … En préparation → Annulée                            | `orders.cancel`                              | motif obligatoire, sans réouverture       |

Chaque transition est horodatée dans `OrderStatusChange` (historique de la fiche) et dans le
journal d'audit. **Modification selon le statut** : tout est libre avant confirmation ; une fois
confirmée, notes et nom du lieu restent libres, mais date, adresse, invités et prestations
demandent `orders.edit_confirmed` et un motif (conservé dans l'historique) ; le client ne peut
plus changer. En préparation, la date est figée ; ensuite, seules les notes internes changent.

**Disponibilité** : à la création, au changement de date et à la confirmation, l'API refuse
(409 `AVAILABILITY_CONFLICT`) une date bloquée ou un jour dont les commandes fermes atteignent
`maxEventsPerDay` ; le traiteur peut passer outre après confirmation, et c'est tracé. Les
commandes en attente ne consomment pas de capacité ; un événement qui finit après minuit ne
compte que le jour de son début. Les contrôles d'un même jour sont sérialisés (verrou PostgreSQL).

**Modifications simultanées** : verrouillage optimiste. `Order.version` est incrémentée par un
trigger à chaque écriture (en-tête, lignes via `DocumentLinesService`, statut) ; une écriture
avec une version périmée reçoit un 409 `ORDER_VERSION_CONFLICT` (« modifiée par X à HH:MM »), et
l'interface propose de recharger.

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

| Dossier        | Contenu                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `config/`      | Validation Zod des variables d'environnement                            |
| `prisma/`      | Client Prisma (pilote PostgreSQL natif `adapter-pg`)                    |
| `redis/`       | Connexion Redis (cache des permissions et des fonctionnalités)          |
| `queue/`       | Connexion BullMQ (Redis)                                                |
| `jobs/`        | Tâches BullMQ, chargées par le worker seul (`src/worker.ts`)            |
| `pdf/`         | Rendu Typst dans un pool de threads (`PDF_WORKERS`, délai par document) |
| `storage/`     | Stockage S3 (URL présignées, traitement des images avec sharp)          |
| `catalog/`     | Catégories, plats, formules, services, photos (`/api/v1/catalog`)       |
| `clients/`     | Clients du traiteur, adresses (`/api/v1/clients`)                       |
| `orders/`      | Commandes, disponibilité, calendrier, tableau de bord                   |
| `payments/`    | Encaissements, remboursements, reçus, échéancier                        |
| `quotes/`      | Devis : versions, envoi, lien public, accords, expiration               |
| `staff/`       | Personnel : invitations et activation, suspension, permissions          |
| `assignments/` | Affectations, planning, missions, bons de préparation et de livraison   |
| `invoices/`    | Factures et avoirs, PDF figé, export comptable (xlsx, CSV)              |
| `pdf/`         | Génération des documents PDF (Typst), libellés FR/AR                    |
| `settings/`    | Paramètres (entreprise, documents, disponibilités, prix) et Mon compte  |
| `auth/`        | Inscription, connexion, OTP SMS, JWT, refresh tokens                    |
| `access/`      | Permissions, feature flags et les 5 guards globaux                      |
| `sequences/`   | Numérotation continue des documents                                     |
| `documents/`   | Lignes de commande et de devis (seul point d’écriture, totaux inclus)   |
| `audit/`       | Journal d'audit (authentification, catalogue)                           |

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
- **Permissions critiques** (`isTenantEditable = false` : facturation, abonnement, audit,
  écriture du catalogue…) : les surcharges du traiteur sont ignorées, et supprimées par la
  synchronisation des permissions (`sync-permissions`, à chaque déploiement).
- Résultat mis en cache dans Redis (5 min). Si Redis est indisponible, lecture directe en base.
- Le catalogue des clés est dans `packages/shared/src/access/permissions.ts`. Il sert au seed et
  au typage ; à l'exécution, seuls les droits en base comptent. Après une évolution de la matrice
  par défaut (ex. rôle Équipe, livreur sans `payments.record`), relancer `pnpm db:seed` pour
  l'appliquer : les surcharges des traiteurs sont conservées (sauf sur les permissions critiques).
- Les traiteurs ajustent leurs rôles depuis la grille des permissions (Personnel → Permissions) :
  `GET/PUT /settings/permissions`, `POST /settings/permissions/reset`.

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

**Libellés multilingues** : chaque ligne (commande, devis, facture) garde son libellé figé dans
toutes les langues disponibles (`LocalizedText { fr, ar?, en? }`, colonne JSONB `label`), copié
du catalogue au moment de l'ajout ; une ligne libre se saisit en français et/ou en arabe (sans
français, le texte arabe sert de repli). Chaque document s'affiche entièrement dans sa langue,
avec repli sur le français. Les libellés produits par l'application (acompte, acompte déduit,
frais d'annulation, remboursement) sont rédigés dans toutes les langues. La base exige un
libellé français non vide (`CHECK`).

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

- **Immuables**, garanti par des triggers PostgreSQL : ni modification, ni suppression, ni ajout
  de ligne après émission ; seul le PDF figé (`pdfKey`, `pdfSha256`, `pdfTemplate`) est renseigné,
  une seule fois. Date d'émission forcée à l'heure de la transaction.
- Vérification différée en fin de transaction : au moins une ligne, totaux égaux à la somme des
  lignes.
- Correction par **avoir** (`type = CREDIT_NOTE`, montants négatifs) qui référence
  obligatoirement une facture de la même commande et de même nature ; le total des avoirs d'une
  facture ne dépasse jamais son montant (vérifié en fin de transaction).
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
- **Double authentification (TOTP, RFC 6238)** : obligatoire pour le SUPER_ADMIN (aucune session
  tant qu'elle n'est pas activée, y compris au rafraîchissement), facultative pour les autres
  comptes (« Mon compte »). Après le mot de passe ou le code SMS, l'API répond
  `{ twoFactor: VERIFY | SETUP, challengeToken }` au lieu d'une session ; le code est vérifié par
  `POST /auth/2fa/verify` (jeton de 10 minutes, 5 essais, usage unique ; chaque échec compte pour
  le verrouillage progressif du compte). Un code de l'application ne sert jamais deux fois. Secret
  chiffré en base (AES-256-GCM, `TWO_FACTOR_ENCRYPTION_KEY`) ; 10 codes de secours à usage
  unique, conservés en empreinte, affichés une seule fois. Le back-office ne pose le cookie de
  session qu'après la deuxième étape.

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
Nginx local), jamais en repassant par Cloudflare, et `PUBLIC_API_URL` passe par le même
proxy que le site. Ne faites jamais confiance à une adresse qui n'est pas un proxy.

### Opérations lentes et transactions

Règle : **aucune opération lente (rendu PDF Typst, stockage S3, SMS) pendant qu'une transaction
tient des verrous**.

- **Rendu Typst hors du thread principal** : Typst est synchrone ; il tourne dans un pool de
  `worker_threads` (`PDF_WORKERS`, 2 par défaut, chaque thread rend un document à la fois, file
  d'attente au-delà). Un document qui dépasse `PDF_RENDER_TIMEOUT_MS` (20 s par défaut) est
  interrompu (503 `PDF_TIMEOUT`, ou reprise automatique pour un document figé) et son thread
  remplacé. Un test vérifie que l'API répond en quelques millisecondes pendant la génération
  d'un lot de PDF lourds (`pdf-responsiveness.int-spec.ts`).
- **Tâches de fond dans un processus séparé** (worker) : l'API reste réactive quoi qu'il arrive
  aux traitements planifiés.

- **Avant la transaction** : ce qui peut échouer sans conséquence. Photos (logo, chèque, pièce
  jointe d'un accord manuel) réencodées et envoyées au stockage, puis référencées dans la
  transaction ; en cas d'échec de celle-ci, le fichier est supprimé ou nettoyé par la tâche des
  24 h. Copie d'une photo déjà utilisée (duplication d'un plat ou d'une formule) :
  `MediaService.prepare`, la transaction n'écrit plus qu'en base (`attach`).
- **Après le commit** : PDF figés (factures et avoirs, reçus, devis envoyés) et SMS (codes,
  invitations). Le document est valide sans son PDF ; un échec du rendu ou du stockage ne fait
  jamais échouer la requête. Reprise : au premier téléchargement, et sinon automatiquement par
  la tâche BullMQ `documents` (toutes les 5 minutes, documents sans PDF depuis plus de 2
  minutes, 25 par type et par passage, `DocumentRecoveryService`). Le rendu est déterministe et
  la clé ne s'enregistre qu'une fois : une reprise concurrente donne le même fichier.
- Un SMS en échec n'annule rien : le code OTP libère sa place dans le plafond d'envoi,
  l'invitation reste copiable par l'administrateur.

### Suivi des erreurs (Sentry)

Actif seulement si `SENTRY_DSN` est renseigné (API, worker, serveur Next) et `PUBLIC_SENTRY_DSN`
(navigateur). **Aucune donnée personnelle ni secret n'est envoyé** :

- collecte du SDK entièrement désactivée (`dataCollection`, qui remplace `sendDefaultPii` en
  v11 : utilisateur, cookies, en-têtes, corps, paramètres d'URL, données SQL, arguments des
  tâches, variables locales, extraits de code source) ;
- filtre partagé `packages/shared/src/observability/scrub.ts` sur chaque événement, span et fil
  d'Ariane : champs sensibles masqués par leur nom (mot de passe, jeton, téléphone, e-mail, nom,
  adresse…), e-mails, téléphones et jetons masqués dans tous les textes ;
- pas de Session Replay ni de traces de performance ; seules les erreurs 5xx et les exceptions
  inattendues sont envoyées (pas les erreurs métier 4xx), ainsi que les tâches BullMQ en échec.

Tests : `scrub.spec.ts` (shared), `sentry-options.spec.ts` (web) et `sentry-privacy.int-spec.ts`
(API : requête chargée de données personnelles et de secrets, chaîne complète du SDK, rien de
personnel dans ce qui partirait).

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

# Parcours e2e du back-office (Playwright) : connexion ; plat avec photo et formule ;
# client, commande de 3 lignes confirmée et retrouvée dans le calendrier ; devis envoyé par
# lien sécurisé, accepté en ligne, facture d'acompte et export CSV ; livreur invité, activé,
# affecté, qui ne voit que sa mission sans prix ; encaissement déclaré par le livreur, remis à la
# caisse, reçu émis ; paramètres (fermeture hebdomadaire, mode de prix, mon compte) ; matériel
# dans une commande (stock, alerte, confirmation motivée).
# Environnement DÉDIÉ, jamais la base de démonstration : base gestion_traiteurs_e2e recréée et
# seedée à chaque lancement (nom vérifié), Redis n° 1, API sur le port 3100 et back-office
# compilé à part (.next-e2e) sur le port 3101. Docker démarré ; rien d'autre à lancer.
pnpm --filter @traiteur/web exec playwright install chromium   # une seule fois
pnpm --filter @traiteur/web test:e2e
```

Les tests d'intégration couvrent la numérotation sous 50 transactions simultanées, l'absence de
trou après un échec, l'isolation entre traiteurs imposée par la base, les contraintes `CHECK`
et l'immuabilité des factures, ainsi que l'API du catalogue (isolation entre traiteurs,
permissions, prix HT/TTC, archivage, audit, photos) et celle des clients et commandes
(isolation, création ou rattachement d'un client, machine à états, règles de modification,
verrouillage optimiste sous écritures simultanées, disponibilité et capacité, tableau de bord),
des paiements et des devis (versions, lien public et ses en-têtes, accord en ligne ou manuel,
jour complet, refus, expiration, remplacement, isolation, offre) et des factures (acompte
puis solde, avoirs, numérotation partagée, annulation, frais, immuabilité, export).
Par sécurité, ils refusent de s'exécuter sur une base dont le nom ne se termine pas par `_test`.

**CI GitHub Actions** (`.github/workflows/ci.yml`), à chaque push sur `main` et chaque pull
request :

1. Formatage, lint, typecheck, tests unitaires et build.
2. Avec PostgreSQL, Redis et RustFS : migrations, détection d'écart schéma/migrations, seed
   exécuté deux fois (idempotence), tests d'intégration, parcours e2e Playwright.

## Référence des commandes

| Commande                                                  | Effet                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm docker:up` / `pnpm docker:down`                     | Démarre / arrête PostgreSQL, Redis et RustFS                                   |
| `pnpm db:migrate`                                         | Crée et applique les migrations (développement)                                |
| `pnpm db:seed`                                            | Charge les données de démonstration                                            |
| `pnpm db:reset`                                           | Vide la base, réapplique les migrations et le seed                             |
| `pnpm db:generate`                                        | Régénère le client Prisma                                                      |
| `pnpm --filter @traiteur/api db:deploy`                   | Applique les migrations (production / CI)                                      |
| `pnpm --filter @traiteur/api db:patch-set-null <fichier>` | Réécrit les SET NULL composites d'une migration                                |
| `pnpm --filter @traiteur/api db:check-drift`              | Vérifie que schéma et migrations concordent                                    |
| `pnpm --filter @traiteur/api db:studio`                   | Interface graphique de la base                                                 |
| `pnpm --filter @traiteur/api catalog:set-photo …`         | Remplace la photo d'un plat ou d'une formule                                   |
| `pnpm --filter @traiteur/web test:e2e`                    | Parcours Playwright du back-office                                             |
| `pnpm clean`                                              | Vide `.turbo`, les `.next/cache`, `dist` et `*.tsbuildinfo` (serveurs arrêtés) |

## Mise en production

Guide pas à pas : **[docs/deploiement.md](docs/deploiement.md)** (domaine, Cloudflare R2,
serveurs Hetzner, GitHub Actions, alertes, sauvegardes, création du traiteur pilote, checklist
avant la mise en production, retour en arrière, restauration).

| Élément                                                                                                 | Emplacement                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Images Docker (construites uniquement par GitHub Actions)                                               | `docker/api.Dockerfile` (API, worker, migrations, commandes), `docker/web.Dockerfile`                                                                                                                                                                                                            |
| Services d'un serveur                                                                                   | `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`                                                                                                                                                                                                                                             |
| Configuration d'un serveur (modèle, avec la commande de chaque secret)                                  | `deploy/env.example`                                                                                                                                                                                                                                                                             |
| Scripts serveur                                                                                         | `deploy/scripts/` : `bootstrap-server.sh`, `deploy.sh`, `backup.sh`, `restore.sh`, `verify-backup.sh`, `check-backup-lock.sh`, `ci-deploy.sh`, `compose.sh`                                                                                                                                      |
| Déploiement                                                                                             | `.github/workflows/deploy.yml` : staging après chaque CI réussie sur `main`, production sur étiquette `v*` (approbation en plus si l'offre GitHub la permet) ; secrets `STAGING_SSH_*` / `PRODUCTION_SSH_*` du dépôt, public ou privé ; démarrage réel des images vérifié avant tout déploiement |
| Test réel des sauvegardes                                                                               | `deploy/tests/backup-restore.sh` (aussi en CI)                                                                                                                                                                                                                                                   |
| Création d'un traiteur                                                                                  | `node dist/cli/create-traiteur.js` (dans l'image API)                                                                                                                                                                                                                                            |
| Compte super admin : création (lien de 24 h), réinitialisation de secours de la double authentification | `node dist/cli/super-admin.js create` / `reset-2fa` (dans l'image API, voir docs/deploiement.md étape 13)                                                                                                                                                                                        |

Ne construisez pas les images sur le poste de développement : elles occupent plusieurs Go
(le disque virtuel de Docker Desktop ne rend pas l'espace tout seul).

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
  `PUBLIC_MEDIA_URL` (web) correspond à `S3_PUBLIC_URL` (API).
- **Disque plein / cache Turborepo trop gros** : le cache local est limité dans `turbo.json`
  (`cacheMaxSize` 1 Go, `cacheMaxAge` 7 jours, éviction au début de chaque `turbo run`) et
  n'enregistre pas `.next/dev` (sortie du serveur de dev, plus d'1 Go). Pour tout vider :
  arrêtez les serveurs de dev, `pnpm clean`, puis `pnpm build`.
- **Heures de Casablanca décalées d'une heure / tests de fuseau en échec** (« base des fuseaux
  à jour » en rouge) : le Maroc est passé à UTC+0 permanent le 20 septembre 2026 (IANA
  2026c). Node antérieur à 24.21 (`node -p process.versions.tz` < `2026c`) l'ignore :
  `winget upgrade OpenJS.NodeJS.LTS` puis rouvrez le terminal. En production, l'API et le
  worker refusent de démarrer avec une base obsolète (les images Docker sont à jour).
- **Client Prisma introuvable ou obsolète** : `pnpm db:generate` (Prisma 7 ne le régénère plus
  automatiquement après une migration).

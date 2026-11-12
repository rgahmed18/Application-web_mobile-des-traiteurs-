# Site client des traiteurs

Chaque traiteur a un site pour ses clients à la racine de son adresse
(`https://dar-diafa.DOMAINE/`), en français et en arabe, pensé pour le téléphone. Le back-office
reste sous `/admin`. Sur l'adresse de la console, la racine renvoie vers `/admin`.

## Pages

| Adresse                                | Contenu                                                                        | Accès                  |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| `/`                                    | Accueil : photos, présentation, types d'événement, contact                     | public                 |
| `/catalogue`, `/catalogue/<type>/<id>` | Menus, buffets, matériel, services ; filtres type d'événement et gamme ; fiche | public                 |
| `/demande`                             | « Ma demande » ; envoi en 4 étapes une fois connecté                           | public, envoi : client |
| `/connexion`                           | Connexion et inscription par code (SMS, ou e-mail pour un numéro étranger)     | public                 |
| `/confidentialite`                     | Politique de confidentialité du traiteur (loi 09-08)                           | public                 |
| `/espace` et sous-pages                | Demandes, devis, factures et reçus, paiements, profil et adresses              | client connecté        |

## Données et confidentialité

- **Catalogue public** : éléments actifs et non archivés, prix TTC. Jamais de stock, de prix HT
  ou de remplacement, de taux de TVA ni d'élément désactivé.
- **Disponibilité** (client connecté) : « Disponible » ou « Sur demande » pour la date
  (fermeture, date bloquée, capacité, date trop proche) et pour chaque matériel (stock sur la
  période). Jamais de chiffre.
- **« Ma demande »** : gardée dans le navigateur (`localStorage`, clé `gt-demande:<traiteur>`),
  uniquement des références du catalogue et des quantités, revalidées à la lecture. Vidée à la
  fin de la session, avec toutes les données chargées.
- **Inscription** : la fiche client (`Membership`) porte le nom saisi chez CE traiteur. Rien
  n'est lu ni recopié d'un autre traiteur ; un numéro connu ailleurs reçoit exactement la même
  réponse qu'un numéro inconnu. Consentement horodaté : date, version de la politique, adresse IP.
- **Espace client** : toujours la fiche de la session, jamais un identifiant envoyé par le
  navigateur. Un élément d'un autre client ou d'un autre traiteur répond 404. Ni note interne,
  ni note de service, ni personnel affecté, ni nom d'employé : l'historique dit « par vous » ou
  « par le traiteur ».
- **Politique de confidentialité** : modèle généré (FR/AR) avec les informations légales du
  traiteur, n° CNDP et paragraphe libre (Paramètres → Site client). Sa version change avec son
  contenu ; les consentements gardent la version acceptée. **À faire relire par un juriste
  avant l'ouverture au public** (rappel affiché dans les paramètres).

## Sessions

Deux sessions indépendantes sur la même adresse, chacune avec ses cookies httpOnly, Secure et
SameSite=Strict :

| Espace      | Routes                  | Cookie de session   | Repère (lisible)  |
| ----------- | ----------------------- | ------------------- | ----------------- |
| Back-office | `/api/session/*`        | `gt_refresh`        | `gt_session_mark` |
| Site client | `/api/client-session/*` | `gt_client_refresh` | `gt_client_mark`  |

Mêmes protections : jeton d'accès en mémoire seulement, rotation à usage unique avec détection
de réutilisation (toute la famille révoquée), contrôle de l'origine, session refusée et révoquée
si elle ne correspond pas à l'adresse (client d'un autre traiteur, personnel sur le site client,
client au back-office).

## Anti-abus

| Protection                                       | Valeur par défaut        | Variable                                                 |
| ------------------------------------------------ | ------------------------ | -------------------------------------------------------- |
| Délai entre deux codes (même numéro, même usage) | 60 s                     | `OTP_RESEND_COOLDOWN_SECONDS`                            |
| Codes par numéro et par adresse e-mail           | 5 par heure              | `OTP_MAX_PER_HOUR`                                       |
| Codes par adresse IP                             | 20 par jour              | `OTP_MAX_PER_IP_PER_DAY`                                 |
| Plafond global de SMS / d'e-mails                | 2 000 / 500 par 24 h     | `SMS_DAILY_GLOBAL_LIMIT`, `EMAIL_DAILY_GLOBAL_LIMIT`     |
| Demandes en ligne par client                     | 3 sur 24 h, 5 en attente | `CLIENT_REQUESTS_PER_DAY`, `CLIENT_PENDING_REQUESTS_MAX` |
| Limites de débit par IP (Redis)                  | par route                | décorateurs `@Throttle`                                  |

## Codes par e-mail (numéros étrangers)

Un numéro hors `SMS_ALLOWED_COUNTRY_CODES` reçoit son code par e-mail : l'adresse est alors
obligatoire et liée au code comme le numéro. Pour un compte existant, l'e-mail ne part que si
l'adresse est celle du compte (ou de sa fiche chez ce traiteur), avec une réponse identique dans
tous les cas. Fournisseur : `EMAIL_PROVIDER` = `console` (développement, démonstration), `http`
(API d'envoi, exemple Brevo dans `apps/api/.env.example`) ou `disabled` (par défaut en
production tant que rien n'est configuré). Voir `docs/deploiement.md`.

## Validation des nouveaux clients

Paramètres → Site client → « Validation des nouveaux clients » (désactivée par défaut). Activée :
un client inscrit en ligne voit son espace mais ne peut pas envoyer de demande avant l'accord du
traiteur (fiche client : Accepter / Refuser avec motif, décision réversible ; filtre « À valider »
dans la liste). Le client est prévenu par SMS, ou par e-mail pour un numéro étranger.
Permission `clients.approve` (gérant et employé par défaut).

## Demandes en ligne

Une demande devient une commande « En attente », origine `ONLINE` (badge « Demande en ligne »
et filtre au back-office), puis suit le parcours habituel : devis, acceptation (page publique ou
espace client), acompte, confirmation. Les lignes sont créées par `DocumentLinesService` depuis le
catalogue publié : prix dans le mode du traiteur, TVA de l'élément, quantité par invité pour les
menus, buffets et services comptés par personne. Le client peut annuler tant que la demande est
en attente.

## Notifications

Cloche du back-office : nouveau client (ou client à valider), nouvelle demande, demande annulée,
devis accepté ou refusé par le client. Chaque type n'est montré qu'aux membres qui ont la
permission liée (`clients.read`, `clients.approve`, `orders.read`, `quotes.read`), la lecture est
propre à chaque membre. Les notifications sont enregistrées dans la transaction de l'événement,
puis confiées à la file BullMQ `notifications` ; seul le canal « dans l'application » existe, les
canaux SMS et WhatsApp s'ajouteront derrière l'interface `NotificationChannel`.

## Tests

- **Intégration** (`apps/api/test/integration`) : `public-catalog-api` (accueil, politique,
  services, rien d'interne), `client-auth-api` (SMS, e-mail, autre traiteur, consentement,
  personnel), `client-approval-api`, `client-requests-api` (prix du serveur, limites,
  annulation), `client-space-api` (isolation entre clients et entre traiteurs, données internes
  absentes, devis, factures, reçus, profil), `notifications-api`.
- **Unitaires** : codes par e-mail et fournisseur (`otp.service.spec`, `email.provider.spec`),
  sessions séparées et liées à l'adresse (`bff.spec`), « ma demande » (`cart-store.spec`),
  retour après connexion (`site-redirect.spec`).
- **E2E** (`apps/web/e2e/site-*.spec.ts`) : visiteur et catalogue sur téléphone, inscription
  (SMS, e-mail en arabe), validation par le traiteur, demande en ligne et cloche, devis accepté
  dans l'espace et historique des deux côtés, annulation, profil, pages en arabe sur téléphone.
  Les codes sont lus dans la boîte d'envoi des parcours (`SMS_PROVIDER=outbox`,
  `EMAIL_PROVIDER=outbox`, interdite en production).

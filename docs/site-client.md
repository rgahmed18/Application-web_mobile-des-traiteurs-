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

## Accueil et apparence

- **Accueil** : bandeau plein écran (photo principale, nom, présentation, « Demander un devis » et
  « Voir le catalogue »), « Pour vos événements » (cartes vers le catalogue filtré), menus phares,
  « Comment ça marche », galerie (photos du site), contact. Carrousels sur téléphone, grilles sur
  grand écran ; apparition au défilement, désactivée avec « réduire les animations ».
- **Paramètres → Site client** : palette parmi 6 (contraste WCAG AA vérifié par test), numéro
  WhatsApp du bouton flottant (message prérempli), 3 à 6 menus et buffets phares (sans choix : les
  premiers publiés avec photo), photo propre à chaque type d'événement (sinon celle d'un menu
  publié de ce type).
- **Polices** : titres en Cormorant Garamond (latin) ou Amiri (arabe), jamais sous 24 px ni pour
  le texte courant ; texte en Manrope ou IBM Plex Sans Arabic. Hébergées avec le site.
- **En-tête** : collant en haut de l'écran, fond ivoire flouté dès que la page défile (opaque
  sur les navigateurs sans flou) ; sur l'accueil, transparent sur la photo jusque-là. Lien actif
  souligné d'un fin trait dans la couleur principale ; langue en petite pastille ; « Demander un
  devis » toujours visible (« Devis » sur téléphone, avec le nombre d'éléments choisis).
- **Téléphone** : menu plein écran (liens, devis, connexion, WhatsApp, langue), sans barre en bas
  de l'écran ; le bouton WhatsApp reste en bas. Pied de page : « © traiteur », politique de
  confidentialité, « Propulsé par Walima Pro ».
- **Catalogue** : bandeau de titre (police des titres, ornement zellige discret), filtres en
  pastilles (type d'événement, gamme avec son symbole), onglets soulignés.

## Gammes : finitions, comparateur, montée en gamme

- **Catalogue → Listes → Gammes** : nom, description et « Ce qui est inclus » (FR/AR, une ligne
  par élément, 12 au plus) ; finition sur le site : Ivoire, Bronze ou Or. Par défaut, Standard
  (affichée « Essentiel » si son nom n'a pas été changé) en ivoire, Premium en bronze, Luxe en or.
- **Finitions** : symbole (losange, étoile marocaine à 8 branches, couronne) toujours accompagné du
  nom, jamais la couleur seule ; contraste des badges vérifié par test (`range-finish.spec.ts`).
  Cartes : bordure fine (ivoire), bordure bronze avec reflet au survol (bronze), bordure dorée en
  dégradé sur fond ivoire profond, titre calligraphié (Cormorant italique, Aref Ruqaa en arabe,
  chargée seulement si affichée) et lueur au survol (or). Reflet, lueur, zoom et soulèvement
  coupés avec « réduire les animations ».
- **Cartes et fiches** : deux lignes de « Ce qui est inclus » sur chaque carte (l'Essentiel met en
  avant ce qu'il offre) ; encart « Inclus dans la gamme » sur la fiche.
- **Comparateur** (`/catalogue/comparer?type=WEDDING`, et section « Choisissez votre gamme » de
  l'accueil) : un onglet par type d'événement ayant au moins un menu publié (jamais d'onglet
  vide). Toutes les gammes publiées, toujours Essentiel → Premium → Luxe : photo du menu, prix par
  personne, estimation du total dès que le nombre d'invités est saisi, plats, « Ce qui est
  inclus » ; « Choisir cette gamme » ajoute le menu à « Ma demande » (si une formule du même
  événement y est déjà : « Remplacer » ou « Garder les deux »). Gamme sans menu pour
  l'événement : « Sur demande », « Demander cette gamme » ajoute « Gamme X — sur demande » (ligne
  sans prix de la commande, chiffrée par le traiteur dans son devis). Badge « Le plus choisi » sur
  la gamme réglée dans Paramètres → Site client (Premium par défaut, ou aucune). Téléphone :
  carrousel (gamme mise en avant en premier, points de position) et barre fixe « Choisir … ».
  Accessible depuis chaque filtre « Événement » du catalogue, les fiches et l'accueil.
- **Nombre d'invités** : un seul pour toute la demande, saisi au clavier (entier de 1 à 5 000,
  boutons − / +, vide au départ) dans le comparateur, les fiches des menus et « Ma demande » ;
  gardé dans le navigateur avec « Ma demande » (aucune donnée personnelle), repris par la demande
  envoyée au traiteur. Hors des limites d'un menu : avertissement, le choix reste possible.
- **« Ma demande »** : chaque ligne avec son estimation (« 280,00 MAD / pers. × 150 invités =
  env. 42 000 MAD »), total estimé (« estimation, le devis final est envoyé par le traiteur ») ;
  plusieurs formules pour un même événement : alternatives marquées « Option », note « Vous
  hésitez entre plusieurs gammes ? » et total en fourchette (« entre 42 000 et 67 500 MAD, selon
  la gamme choisie » : la formule la moins chère → la plus chère, plus le reste), jamais leur
  somme. Au back-office, une demande en ligne à plusieurs formules indique « Le client hésite
  entre N gammes » et présente son total TTC en fourchette.
- **Montants** : format unique de packages/shared (« 163 500,00 MAD ») : espace insécable fine
  (U+202F) entre les milliers ; en arabe, montant isolé de gauche à droite (LRI … PDI) et
  « د.م. » isolé après lui, sur le site, au back-office et dans les PDF.
- **Couverture des gammes** (Catalogue → Menus) : tableau événements × gammes, « ✓ » ou
  « manquant », pour voir ce qui s'affichera « sur demande ».
- **Titres arabes** : Aref Ruqaa pour les grands titres de page ; Amiri pour les titres des cartes
  et des menus (doré pour la gamme Luxe).
- **Montée en gamme** (« Ma demande ») : menu publié le moins cher de la gamme juste au-dessus,
  pour un même type d'événement, plus cher et pas déjà choisi : « Pour X de plus par personne,
  passez en … ». « Passer en … » remplace le menu ; « Non merci » la masque pour la visite.
  Désactivable : Paramètres → Site client → Montée en gamme.

## Données et confidentialité

- **Catalogue public** : éléments disponibles, non archivés et **publiés sur le site** (case « Publié
  sur le site » de chaque menu, buffet, matériel et service, désactivée pour un nouvel élément ;
  « Hors site » dans les listes). Avant publication, la fiche signale une photo, une description
  ou une traduction arabe manquante. Prix TTC ; jamais de stock, de prix HT ou de remplacement,
  de taux de TVA ni d'élément désactivé. Une demande en ligne refuse un élément non publié.
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

## Listes en arabe

Les noms des listes du catalogue (types d'événement, gammes, types de buffet, catégories de
matériel) s'affichent sur le site : le nom arabe est obligatoire à la création et à chaque
modification. Un nom ancien sans arabe est signalé « Arabe manquant » dans Catalogue → Listes et
n'apparaît pas sur le site, ni en français ni en arabe (même comportement dans les deux langues).
Le type « Autre » est toujours proposé en dernier, au back-office comme sur le site.

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

**Règles du traiteur** (Paramètres → Site client → Demandes en ligne), vérifiées à l'identique
par le site et par l'API (`packages/shared/src/site/request-rules.ts`) :

- nombre d'invités de `requestMinGuests` à `requestMaxGuests` (défaut 10 à 5 000) ; sous le
  minimum : « Nous acceptons les demandes à partir de 10 invités » (`GUESTS_BELOW_MINIMUM`). Le
  champ est vide au départ, « Ex. : 150 » n'est qu'un exemple ;
- délai minimum `requestLeadDays` (défaut 3 jours) : première date = aujourd'hui (jour civil du
  traiteur) + délai, sinon `DATE_TOO_SOON`. Le calendrier de l'assistant grise les dates trop
  proches, les jours fermés (fermeture hebdomadaire, date bloquée) et complets (capacité
  atteinte), via `GET /client/calendar` (aucun chiffre), avec un lien WhatsApp (ou téléphone)
  « Pour une date plus proche, contactez-nous » ;
- les limites propres à un menu (ex. 80 à 600) et le minimum d'un buffet ne sont qu'un
  avertissement : la demande part, le traiteur ajuste son devis ;
- type d'événement prérempli quand toutes les formules visent le même ; formule prévue pour un
  autre type (Aqiqa avec « Formule Mariage Essentiel ») : avertissement « Continuer / Changer de
  formule », jamais de blocage.

**Date civile de bout en bout.** La date et les heures de l'événement sont stockées telles que
saisies, sans fuseau (`Order.eventDay` DATE, `startTime`, `endTime`, `endsNextDay`) et relues
telles quelles par le back-office, l'espace client, les listes, le calendrier et les PDF
(`apps/api/src/orders/event-schedule.ts`). Les instants UTC `eventDate` / `eventEndDate` restent,
dérivés dans le fuseau du traiteur, pour les chevauchements (matériel, planning). Le calendrier du
site travaille en chaînes « AAAA-MM-JJ », jamais en objets `Date` du navigateur : le jour ne
dépend ni du fuseau de l'appareil ni d'une mise à jour de la base des fuseaux (Maroc à UTC+0
depuis 2026).

## Paramètres : modifications non enregistrées

Sur les pages Paramètres, une barre fixe en bas apparaît dès qu'un réglage change :
« Modifications non enregistrées — Annuler / Enregistrer » (`UnsavedChangesBar`) ; les
formulaires longs (catalogue, commande) signalent de même leur barre d'actions. Quitter la page
sans enregistrer demande confirmation. Le brouillon automatique s'affiche « Brouillon enregistré
à … (non appliqué) » : seul « Enregistrer » applique les réglages.

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
  règles du traiteur, date civile près de minuit, calendrier, annulation), `client-space-api` (isolation entre clients et entre traiteurs, données internes
  absentes, devis, factures, reçus, profil), `notifications-api`.
- **Unitaires** : codes par e-mail et fournisseur (`otp.service.spec`, `email.provider.spec`),
  sessions séparées et liées à l'adresse (`bff.spec`), « ma demande » (`cart-store.spec`),
  retour après connexion (`site-redirect.spec`), règles des demandes (`request-rules.spec`),
  calendrier civil (`event-date.spec`), cohérence type / formules (`request-checks.spec`),
  horaire civil (`event-schedule.spec`).
- **E2e** : `site-request-rules` (invités, délai, jours grisés, WhatsApp, type d'événement,
  navigateur à Casablanca, Paris et New York avec des événements autour de minuit), barre des
  modifications non enregistrées (`settings`).
- **E2E** (`apps/web/e2e/site-*.spec.ts`) : visiteur et catalogue sur téléphone, inscription
  (SMS, e-mail en arabe), validation par le traiteur, demande en ligne et cloche, devis accepté
  dans l'espace et historique des deux côtés, annulation, profil, pages en arabe sur téléphone.
  Les codes sont lus dans la boîte d'envoi des parcours (`SMS_PROVIDER=outbox`,
  `EMAIL_PROVIDER=outbox`, interdite en production).

# Analytics Nexus

## Périmètre et dates

Les statistiques ne reconstituent pas l'historique Discord. Elles commencent
avec les premiers événements effectivement reçus après activation de la
collecte. Une indisponibilité du bot, une permission de salon manquante ou une
limite d'intents peut créer des périodes incomplètes ; les agrégats décrivent
les événements observés, pas une garantie d'exhaustivité.

La journée va de minuit à minuit selon `Guild.analyticsTimezone`, UTC par
défaut. Les dates API sont des jours calendaires du serveur (`YYYY-MM-DD`).
Le fuseau peut être changé avec `PUT /api/v1/guilds/:guildId/analytics/timezone`
par un utilisateur disposant de `settings.manage`, avant le premier événement
ingéré. Il est ensuite verrouillé pour ne pas mélanger des dates journalières
calculées selon des fuseaux différents. Les périodes demandées sont limitées à
366 jours.

## Définitions

- **Messages** : messages créés par des membres humains dans des salons que le
  bot peut observer ; les bots, webhooks et messages système sont exclus. Les
  volumes horaires UTC et les compteurs quotidiens locaux par salon sont
  agrégés à l'ingestion, pour garder une attribution exacte des jours même dans
  les fuseaux à décalage fractionnaire.
- **Arrivée / départ** : événement Gateway de membre reçu par le bot, dédupliqué
  avant d'incrémenter l'agrégat journalier.
- **DAU** : nombre de membres humains distincts ayant eu au moins une activité
  éligible sur une journée locale : message, commande slash, ajout de réaction
  ou participation vocale. Arriver, partir, être connecté sans activité ou
  recevoir un message ne compte pas.
- **WAU / MAU** : nombre distinct de membres actifs pendant les 7 ou 30 jours
  calendaires précédant et incluant la date de fin demandée. Ce sont des comptes
  d'identités pseudonymisées uniques, pas la somme des DAU.
- **Comparaison** : périodes de même durée, alignées jour par jour dans le
  graphique ; les totaux sont comparés séparément.

Les sessions vocales commencent lorsque le bot observe l'entrée en vocal et
sont finalisées lors de la sortie. Leur durée est répartie entre les jours
locaux traversés. Un redémarrage du bot pendant une session peut empêcher la
mesure de sa durée ; le membre peut néanmoins avoir été compté au début observé
de la session.

## Données et confidentialité

Aucun contenu de message, texte de commande, nom de réaction ou identifiant de
message n'est conservé dans les statistiques. Pour compter exactement les
membres distincts et empêcher un membre de compter plusieurs fois, le bot
calcule un HMAC avec `BOT_ANALYTICS_KEY` sur l'identifiant Discord et la guild.
La base conserve ce pseudonyme stable avec les compteurs quotidiens
(`DailyMemberActivity`), jamais l'identifiant brut dans cette table. Le
pseudonyme demeure une donnée personnelle pseudonymisée et doit être traité
comme telle. Une rotation de clé interrompt la continuité des comptes distincts
entre les événements produits avec l'ancienne et la nouvelle clé.

Les tables `MessageStatistic` et `DailyMessageStatistic` contiennent les
volumes de messages agrégés par serveur, salon et période ; `GuildDailyStatistic`
contient les volumes d'arrivées et de départs. Les exports CSV contiennent les
séries journalières agrégées et les volumes par salon, ainsi que la période et
le fuseau ; l'accès exige `analytics.export`.

## Endpoints et autorisations

- `GET /api/v1/guilds/:guildId/analytics/overview` — permission
  `analytics.view`, série journalière, totaux, DAU/WAU/MAU, comparaison
  facultative.
- `GET /api/v1/guilds/:guildId/analytics/channels` — permission
  `analytics.view`, pagination `page`/`pageSize` et filtre `channelId`.
- `GET /api/v1/guilds/:guildId/analytics/export.csv` — permission
  `analytics.export`, période maximale de 366 jours et limite d'export de
  10 000 salons.
- `PUT /api/v1/guilds/:guildId/analytics/timezone` — permission
  `settings.manage`, origine de même site et fuseau IANA valide.

Toutes les routes vérifient l'accès session, l'appartenance Nexus à la guild et
la permission côté API. Les requêtes SQL des dépôts filtrent toujours par
`guildId`.

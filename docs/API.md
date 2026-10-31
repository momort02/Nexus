# Nexus — Contrat API initial

Préfixe : `/api/v1`.

## Auth

- `GET /auth/discord`
- `GET /auth/discord/callback`
- `POST /auth/logout`
- `GET /me`

## Guilds

- `GET /guilds`
- `GET /guilds/:guildId`
- `GET /guilds/:guildId/settings`
- `PATCH /guilds/:guildId/settings`

## Dashboard et analytics

- `GET /guilds/:guildId/dashboard`
- `GET /guilds/:guildId/settings`
- `GET /guilds/:guildId/analytics/overview`
- `GET /guilds/:guildId/analytics/messages`
- `GET /guilds/:guildId/analytics/members`
- `GET /guilds/:guildId/analytics/channels`
- `GET /guilds/:guildId/analytics/export`

## Members et staff

- `GET /guilds/:guildId/members`
- `GET /guilds/:guildId/members/:memberId`
- `GET /guilds/:guildId/staff`
- `POST /guilds/:guildId/staff`
- `PATCH /guilds/:guildId/staff/:staffId`

## Moderation

- `GET /guilds/:guildId/moderation/cases`
- `POST /guilds/:guildId/moderation/cases`
- `GET /guilds/:guildId/moderation/cases/:caseId`
- `POST /guilds/:guildId/moderation/cases/:caseId/actions`
- `GET /guilds/:guildId/moderation/appeals`
- `PATCH /guilds/:guildId/moderation/appeals/:appealId`

## Tasks, reports et applications

- `GET|POST /guilds/:guildId/tasks`
- `GET|PATCH|DELETE /guilds/:guildId/tasks/:taskId`
- `GET|POST /guilds/:guildId/reports`
- `GET|PATCH /guilds/:guildId/reports/:reportId`
- `GET|POST /guilds/:guildId/applications`
- `GET|PATCH /guilds/:guildId/applications/:applicationId`

## Permissions et audit

- `GET /guilds/:guildId/roles`
- `POST /guilds/:guildId/roles`
- `PATCH /guilds/:guildId/roles/:roleId`
- `GET /guilds/:guildId/permissions`
- `GET /guilds/:guildId/audit-logs`

## Conventions

- Ajouter pagination cursor-based aux listes volumineuses.
- Filtres et tris validés par Zod.
- Réponses JSON cohérentes.
- Erreurs avec `code`, `message` et `requestId`.
- Ne jamais exposer les tokens ou détails internes.
- Documenter les permissions requises pour chaque endpoint.
- Les endpoints d'écriture créent un audit log lorsque l'action est significative.
- Le contrat final doit être publié en OpenAPI.

## Routes livrées par l’interface

- `GET /guilds/:guildId/dashboard` — session, accès à la guild et permission
  `dashboard.view` ; agrégats des sept derniers jours dans le fuseau du serveur.
- `GET /guilds/:guildId/settings` — session, accès à la guild et permission
  `settings.view` ; renvoie le fuseau des analytics.
- `PUT /guilds/:guildId/analytics/timezone` — permission `settings.manage`.
- `GET /guilds/:guildId/members?page=&pageSize=&search=&roleId=` — permission
  `members.view`, pagination (25 par défaut, 100 maximum), recherche sur
  le pseudo Discord ou l’identifiant et filtre facultatif par rôle Discord. Les
  résultats ne contiennent que les instantanés connus du bot ; le pseudo affiché
  est le surnom du serveur, ou le nom global/nom d’utilisateur Discord si aucun
  surnom n’est défini. Les anciennes fiches restent sans pseudo jusqu’à la
  prochaine synchronisation du bot (`/nexus-sync`). Les modifications du pseudo
  et des rôles observées par le bot actualisent l’instantané.

Les connexions Socket.IO utilisent le cookie de session Nexus. Le client doit
demander `guild:subscribe` avec l’identifiant de la guild ; l’API vérifie à
nouveau l’expiration de la session, l’appartenance à la guild et
`dashboard.view` avant de joindre la room. `guild:updated` ne transmet aucune
donnée métier : le client recharge les ressources via les routes API protégées.

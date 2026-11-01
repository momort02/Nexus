# Nexus

Monorepo pour la plateforme Nexus de gestion et d'analyse de serveurs Discord.
Il contient les applications web, API et bot, l'authentification multi-tenant,
le moteur RBAC et les premières collectes d'événements Discord.

## Prérequis

- Node.js 24 ou version compatible avec les dépendances du workspace.
- pnpm 10.
- Docker Compose pour démarrer PostgreSQL et Redis localement.

## Installation

```sh
corepack pnpm install
corepack pnpm --filter @nexus/api prisma:generate
```

Copiez `.env.example` vers `.env`, puis renseignez les valeurs locales pour
`POSTGRES_DB`, `POSTGRES_USER` et `POSTGRES_PASSWORD` avant de démarrer Compose.
Renseignez `DISCORD_BOT_TOKEN` uniquement si vous lancez le bot. Ne partagez et
ne commitez jamais le fichier `.env`.

## Déploiement en production

Pour déployer sur une VM Ubuntu avec Docker Compose, PostgreSQL privé et HTTPS
automatique via Caddy, suivez [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). Le
dashboard et l'API seront servis sous le même domaine ; le port 80 doit aussi
être accessible pour l'émission et le renouvellement des certificats TLS.

Pour l'authentification, configurez aussi `DATABASE_URL`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `APP_ORIGIN` et
`OAUTH_ENCRYPTION_KEY`. Enregistrez exactement `DISCORD_REDIRECT_URI` comme URL
de redirection OAuth2 dans le portail Discord. Générez la clé de chiffrement
localement avec la commande commentée dans `.env.example` et gardez-la secrète.
Seul le token d'accès Discord temporaire est conservé chiffré dans la session
pour actualiser la liste des serveurs ; aucun refresh token n'est demandé ou
stocké.

## Développement

Démarrer l'API et le site web :

```sh
corepack pnpm dev
```

L'API répond sur `http://localhost:3000/health` par défaut. Le site web utilise
le serveur de développement Vite sur `http://localhost:5173`. La page d'accueil
documente l'installation du bot ; le dashboard est disponible sur
`http://localhost:5173/dashboard/`. En production, le build produit
`dist/index.html` pour l'accueil et `dist/dashboard/index.html` pour le
dashboard. Configurez l'hébergement statique pour servir ce dernier à
`https://mon-url/dashboard/`. Pour OAuth,
gardez le même nom d'hôte (`localhost`) dans le navigateur et dans
`DISCORD_REDIRECT_URI` ; `localhost` et `127.0.0.1` ne partagent pas leurs
cookies.
Après avoir ajouté le bot à un nouveau serveur, connectez-vous au dashboard et
utilisez « Ajouter un serveur » pour actualiser la liste Discord, puis créez
l'espace Nexus correspondant. L'utilisateur connecté doit être propriétaire
du serveur ou disposer de `Manage Server` ; l'installation du bot seule ne
crée pas automatiquement un espace Nexus.

Les pages publiques des documents sont disponibles sur
`http://localhost:5173/terms.html` et `http://localhost:5173/privacy.html` en
développement. Le build web produit également `terms.html` et `privacy.html`.
Pour les renseigner dans le portail Discord, déployez ces pages sur une origine
publique HTTPS et utilisez respectivement `/terms.html` et `/privacy.html`.
Les textes contiennent des champs à compléter et ne doivent pas être publiés
comme documents définitifs avant validation des coordonnées, de l’hébergement
et des durées de conservation.

Démarrer le bot séparément, après avoir configuré son token :

```sh
corepack pnpm --filter @nexus/bot dev
```

### Configuration du bot Discord

Créez une application et un bot dans le [portail développeur Discord](https://discord.com/developers/applications).
Configurez le lien d'installation avec les scopes `bot` et
`applications.commands`. N'accordez au bot que `View Channels` et
`Use Application Commands`. Pour recevoir les réactions, accordez également
`Read Message History`. Le bot ne doit voir que les salons dont les événements
doivent être mesurés. La commande `/nexus-sync` est limitée aux utilisateurs
disposant de `Manage Server` dans Discord.

Activez l'intent privilégié **Guild Members** dans _Bot → Privileged Gateway
Intents_. Il est nécessaire pour les événements d'arrivée/départ et la
synchronisation explicite des membres ainsi que les contrôles de hiérarchie
des actions de modération. Pour les actions activées, accordez seulement les
permissions Discord nécessaires parmi `Moderate Members`, `Kick Members` et
`Ban Members`. Le bot écoute aussi les intents non
privilégiés `Guild Message Reactions` et `Guild Voice States`. Le code n'active
pas l'intent `Message Content` : aucun contenu de message n'est lu ni transmis.
Les statistiques commencent à l'activation de la collecte et ne représentent
pas l'historique antérieur.

Le lien public d'installation est disponible depuis la page d'accueil. Les
commandes sont `/nexus-health` (vérification de la connexion) et `/nexus-sync`
(synchronisation des membres, réservée aux utilisateurs ayant `Manage Server`).
La documentation publique et les permissions minimales sont aussi présentées
sur `http://localhost:5173/`.

Renseignez `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`,
`BOT_API_BASE_URL`, `BOT_API_SECRET`, `BOT_ANALYTICS_KEY` et
`BOT_HEALTH_PORT` dans `.env`.
`BOT_API_SECRET` doit contenir au moins 32 caractères et être identique côté
API et bot ; générez-le localement avec la commande indiquée dans
`.env.example`. `BOT_ANALYTICS_KEY` doit aussi comporter au moins 32
caractères ; il produit des pseudonymes HMAC stables pour compter les membres
distincts sans persister leur ID Discord dans les statistiques. L'API n'accepte
les événements que pour les guilds Nexus enregistrées. Chaque requête bot/API
signe par HMAC la méthode, le chemin, l'horodatage, un nonce UUID et le corps ;
l'API consomme le nonce une seule fois en base. En production,
`BOT_API_BASE_URL` doit utiliser HTTPS. Le transport déduplique les événements
en mémoire, réessaie au plus trois fois et expose l'état du processus sur
`http://localhost:3001/health`.

## Analytics

- `GET /api/v1/guilds/:guildId/analytics/overview` : agrégats journaliers et
  indicateurs DAU/WAU/MAU ; accepte `from`, `to`, `compareFrom` et `compareTo`
  au format `YYYY-MM-DD`.
- `GET /api/v1/guilds/:guildId/analytics/channels` : volumes paginés, filtrables
  par nom (`channelName`) ou identifiant (`channelId`), `from` et `to`.
- `GET /api/v1/guilds/:guildId/analytics/export.csv` : export agrégé, protégé
  par `analytics.export`.
- `PUT /api/v1/guilds/:guildId/analytics/timezone` : configure le fuseau IANA
  du serveur avant le début de la collecte, protégé par `settings.manage`.

Les lectures exigent `analytics.view`, une session et l'accès Nexus à la guild.
Le bot synchronise les noms des salons et rôles Discord au démarrage et lors
de leurs changements. Utilisez `/nexus-sync` pour actualiser les noms des rôles
des membres déjà synchronisés.
Une journée est calculée selon le fuseau du serveur (UTC par défaut). Le DAU est
le nombre de membres humains distincts ayant envoyé un message, ajouté une
réaction, utilisé une commande slash ou participé à une session vocale observée
ce jour-là ; WAU/MAU sont le nombre distinct sur les 7/30 jours jusqu'à la fin
de la période. Les arrivées et départs ne sont pas des activités. Les compteurs
de messages ignorent les bots, webhooks et messages système.

Voir [docs/ANALYTICS.md](./docs/ANALYTICS.md) pour les limites de mesure,
la pseudonymisation et l'interprétation des périodes.

Démarrer PostgreSQL et Redis :

```sh
docker compose up -d
```

Après avoir démarré PostgreSQL, créez le schéma :

```sh
corepack pnpm --filter @nexus/api prisma:migrate
```

Si le retour OAuth affiche `internal_error`, consultez le terminal de l'API.
Une erreur Prisma `P1001` signifie que PostgreSQL n'est pas joignable à
l'adresse configurée dans `DATABASE_URL`. Démarrez PostgreSQL (par exemple
avec `docker compose up -d postgres` si Docker Compose est installé), appliquez
les migrations, puis redémarrez l'API et relancez la connexion depuis l'accueil.
Docker Compose n'est pas fourni avec Node.js ; installez/démarrez Docker Desktop
ou configurez une instance PostgreSQL locale avant cette étape.

Le parcours d'authentification commence sur
`/api/v1/auth/discord`. L'API expose ensuite `/api/v1/me`,
`/api/v1/guilds/available`, `/api/v1/guilds` et
`POST /api/v1/guilds/:guildId/select`. L'utilisateur doit être propriétaire du
serveur Discord ou disposer de `MANAGE_GUILD` pour créer son espace Nexus.
Les sessions sont persistées en base, le cookie est `HttpOnly` et `SameSite=Lax`,
les réponses API n'autorisent que l'origine de `APP_ORIGIN`, et les écritures
vérifient également l'en-tête `Origin`. Chaque lecture par guild vérifie
l'appartenance Nexus côté serveur.

## Rôles et permissions

Le moteur RBAC est appliqué côté API. Les routes de gestion sont :

- `GET /api/v1/guilds/:guildId/permission-catalog`
- `GET /api/v1/guilds/:guildId/roles`
- `POST /api/v1/guilds/:guildId/roles` avec `{ "name": "...", "permissions": { "dashboard.view": "ALLOW" } }`
- `PUT /api/v1/guilds/:guildId/roles/:roleId/permissions` avec `{ "permissions": { ... } }`
- `POST /api/v1/guilds/:guildId/role-assignments` avec `{ "userId": "...", "roleId": "..." }`

Le catalogue et les modèles Owner, Admin, Head Staff, Moderator, Trial
Moderator, Analyst et Viewer sont définis dans l'API et enregistrés par serveur.
Un utilisateur doit d'abord être membre Nexus de la guild. Les rôles système
sont protégés, l'élévation au-delà des permissions de l'acteur est refusée,
l'acteur ne peut pas s'attribuer un rôle et la hiérarchie empêche d'attribuer un
rôle égal ou supérieur. En cas de conflit, un refus explicite prévaut ; Owner
est l'exception système décrite dans `docs/PERMISSIONS.md`.

Les créations/modifications de rôles et les attributions sont enregistrées
transactionnellement dans `PermissionAuditLog`. Les modules Staff, Tasks,
Reports, Applications, Moderation, Appeals, Audit et Notifications sont
disponibles via l'API ; les permissions Nexus sont contrôlées côté serveur et
les dossiers sensibles restent privés. Les actions de modération sont
asynchrones : l'API exige les permissions Nexus et Discord de l'acteur, puis le
bot vérifie ses propres permissions et la hiérarchie Discord avant d'exécuter
l'action. Voir [docs/STAFF_MODERATION.md](./docs/STAFF_MODERATION.md) pour les
routes, statuts et règles de confidentialité.

Commandes de vérification :

```sh
corepack pnpm test
corepack pnpm lint
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm build
```

## Structure

- `apps/web` : HTML, CSS et JavaScript natifs.
- `apps/api` : serveur HTTP Express en TypeScript strict.
- `apps/bot` : bot Discord.js en TypeScript strict.
- `packages/shared` : contrats TypeScript partagés.
- `docs` : spécifications fonctionnelles et techniques.

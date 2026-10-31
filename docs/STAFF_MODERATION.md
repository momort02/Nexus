# Staff, tâches et modération

Toutes les routes utilisateur sont préfixées par
`/api/v1/guilds/:guildId`. Elles exigent une session Nexus et une adhésion
Nexus à la guild ; `guildId` est contrôlé côté serveur. Les écritures exigent
également l’origine configurée. Les routes sont limitées à 60 requêtes par
minute.

L’interface web expose ces espaces depuis la navigation latérale : Staff,
Tâches, Signalements, Candidatures, Modération, Audit et Notifications. Les
listes privées affichent explicitement les erreurs d’accès ; les contrôles
visibles ne remplacent jamais les vérifications d’autorisation de l’API.

## Routes

| Méthode | Route      | Permission / accès                                                  |
| ------- | ---------- | ------------------------------------------------------------------- |
| `GET`   | `/members` | `members.view` ; instantanés connus du bot, recherche et pagination |

| Méthode        | Route                                                    | Permission / accès                                                     |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET`          | `/staff`                                                 | `staff.view`                                                           |
| `PUT`          | `/staff/:userId`                                         | `staff.manage`                                                         |
| `GET`, `POST`  | `/staff/teams`                                           | `staff.view`, `staff.manage`                                           |
| `POST`         | `/staff/teams/:teamId/members`                           | `staff.assign`                                                         |
| `GET`, `POST`  | `/tasks`                                                 | `tasks.view`, `tasks.create`                                           |
| `PATCH`        | `/tasks/:taskId`                                         | `tasks.complete`, `tasks.validate` ou `tasks.update` selon l’opération |
| `POST`         | `/reports`                                               | Membre Nexus du serveur                                                |
| `GET`, `PATCH` | `/reports` et `/reports/:reportId`                       | `reports.view`, `reports.manage`                                       |
| `POST`         | `/applications`                                          | Membre Nexus du serveur                                                |
| `GET`, `PATCH` | `/applications` et `/applications/:applicationId`        | `applications.view`, `applications.review`                             |
| `GET`, `POST`  | `/moderation/cases`                                      | `moderation.view` ; permission Nexus et Discord pour créer une action  |
| `POST`         | `/moderation/cases/:caseId/appeals`                      | Auteur de la sanction concernée                                        |
| `GET`, `PATCH` | `/moderation/appeals` et `/moderation/appeals/:appealId` | `moderation.appeals.view`, `moderation.appeals.manage`                 |
| `GET`          | `/audit`                                                 | `audit.view`                                                           |
| `GET`          | `/notifications`                                         | Notifications de l’utilisateur connecté uniquement                     |
| `POST`         | `/notifications/:notificationId/read`                    | Propriétaire de la notification uniquement                             |

`PUT /staff/:userId` accepte `{ "title": string | null, "active": boolean }`.
La création d’équipe accepte `{ "name": string, "description": string | null }`.
Une tâche accepte `title`, `description`, `assigneeId` (facultatif, profil staff
actif) et `dueAt` (date ISO facultative). Les transitions de tâche utilisent
`status` (`OPEN`, `IN_PROGRESS`, `COMPLETED`, `VALIDATED`) et les commentaires
peuvent être ajoutés avec `comment`.

Les signalements et candidatures sont associés à l’identité de la session,
jamais à un identifiant d’auteur fourni par le navigateur. Les détails et
réponses ne sont accessibles qu’aux permissions staff correspondantes. Les
listes sont limitées aux 100 éléments les plus récents.

## Actions de modération et contestations

La création accepte `targetDiscordId`, `action` (`WARN`, `TIMEOUT`, `KICK`,
`BAN`), `reason` et une durée en secondes uniquement pour `TIMEOUT` (1 seconde
à 28 jours). L’API vérifie la permission Nexus puis récupère les permissions
Discord du compte OAuth de l’acteur. Une action est retournée en `202` avec
l’état `PENDING` ; le bot la prend dans la file signée par HMAC. Avant
l’exécution, il vérifie à nouveau que l’acteur et le bot sont présents, leurs
permissions Discord et la hiérarchie des rôles au-dessus de la cible. L’API
revérifie également la permission Nexus au retrait de la file, afin qu’une
révocation pendant l’attente annule l’action. Le
dossier passe à `COMPLETED` ou `FAILED` uniquement après le résultat Discord.

Les permissions de l’acteur sont `Moderate Members` pour un timeout, `Kick
Members` pour une expulsion et `Ban Members` pour un bannissement. Un
avertissement n’a pas de permission Discord native ; le bot doit pouvoir
contacter la cible, et applique également les contrôles de présence et de
hiérarchie. Les appels bot/API utilisent le secret `BOT_API_SECRET` et signent
par HMAC la méthode, le chemin, l’horodatage, un nonce à usage unique et le
corps ; aucun token n’est transmis au bot ni journalisé.

Une contestation ne peut être déposée que par l’utilisateur Discord ciblé sur
un dossier terminé, avec un seul dépôt par dossier. Les décisions sont
`OPEN`, `ACCEPTED` ou `REJECTED`.

Les changements sensibles produisent des entrées d’audit transactionnelles.
Les notifications sont ciblées par utilisateur Nexus et par guild. Aucun
contenu de conversation ni score de modérateur n’est collecté. Les profils,
commentaires, signalements, candidatures, sanctions et contestations sont des
données privées soumises aux permissions ci-dessus.

Pour activer les sanctions, accorder au bot uniquement les permissions
Discord nécessaires aux actions activées : `Moderate Members`, `Kick Members`
et/ou `Ban Members`. L’intent `Guild Members` doit rester activé ; aucun intent
de contenu des messages n’est requis.

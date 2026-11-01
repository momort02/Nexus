# Nexus — Modèle de données initial

Le schéma Prisma détaillé sera construit par Copilot à partir de ces entités. Toutes les tables propres à un serveur doivent porter une relation ou une clé `guildId` et être interrogées dans le contexte du serveur autorisé.

## Entités

- User : compte Nexus.
- OAuthAccount : fournisseur, identifiant externe et tokens chiffrés si leur conservation est nécessaire.
- Guild : serveur Discord connecté.
- GuildMembership : association utilisateur/espace Nexus.
- GuildSettings : paramètres et préférences.
- GuildMember : membre Discord synchronisé.
- DiscordGuildChannel et DiscordGuildRole : noms Discord synchronisés,
  associés à leur identifiant et isolés par serveur.
- NexusRole : rôle interne d'un serveur.
- Permission : catalogue global de permissions.
- RolePermission : association rôle/permission.
- UserGuildRole : rôles attribués à un utilisateur dans un serveur.
- MemberEvent : arrivée, départ, mise à jour de rôle si nécessaire.
- MessageStatistic : agrégats temporels par serveur et salon.
- StaffProfile : profil staff.
- ModerationCase : dossier de modération.
- ModerationAction : avertissement, timeout, kick, ban ou action manuelle.
- Report : signalement.
- Appeal : contestation.
- StaffTask : tâche.
- StaffTaskComment : commentaire de tâche.
- Application : candidature.
- Notification : notification interne.
- AuditLog : journal d'audit.
- Webhook : intégration sortante.
- ApiKey : empreinte de clé, scopes et révocation.
- BotInstallation : statut d'installation et configuration minimale.
- JobExecution : état des tâches différées si nécessaire.

## Contraintes

- Utiliser les IDs Discord comme chaînes (`String`), jamais comme nombres JavaScript.
- Ajouter les index sur `guildId`, dates, statuts et colonnes de recherche.
- Ajouter des contraintes d'unicité composites, par exemple `[guildId, discordUserId]`.
- Utiliser des timestamps UTC.
- Prévoir `createdAt` et `updatedAt` sur les entités modifiables.
- Conserver les références nécessaires à l'audit sans conserver indéfiniment des données personnelles.
- Ne pas stocker les contenus des messages.
- Utiliser des migrations versionnées.
- Documenter les stratégies de suppression et de rétention.

# Nexus — Modèle de permissions

## 1. Format
Permissions sous forme de clés stables, par exemple `analytics.view`.

## 2. Permissions proposées
```text
dashboard.view
analytics.view
analytics.export
members.view
members.notes.view
members.notes.create
members.notes.update
members.notes.delete
staff.view
staff.manage
staff.promote
staff.assign
moderation.view
moderation.warn
moderation.timeout
moderation.kick
moderation.ban
moderation.appeals.view
moderation.appeals.manage
tasks.view
tasks.create
tasks.assign
tasks.update
tasks.complete
tasks.validate
reports.view
reports.manage
applications.view
applications.review
notifications.manage
settings.view
settings.manage
permissions.view
permissions.manage
audit.view
api_keys.manage
server.delete
```

## 3. Rôles initiaux
- Owner : toutes les permissions ; transfert/suppression de propriété soumis à confirmation renforcée.
- Admin : toutes les permissions opérationnelles, sauf `server.delete` et transfert de propriété.
- Head Staff : `staff.*`, `tasks.*`, `reports.*`, `applications.*`, `moderation.view`, `moderation.appeals.*`, `dashboard.view`.
- Moderator : `dashboard.view`, `members.view`, `moderation.view`, `moderation.warn`, `moderation.timeout`, `reports.view`, `tasks.view`, `tasks.complete`.
- Trial Moderator : lecture et signalement ; actions sensibles désactivées par défaut.
- Analyst : `dashboard.view`, `analytics.view`, `analytics.export` selon configuration.
- Viewer : `dashboard.view`.

Ces profils sont des valeurs par défaut, pas des règles codées en dur.

## 4. Règles d'autorisation
- Les rôles sont associés à un utilisateur dans un serveur Nexus précis.
- Refus par défaut.
- Le backend calcule les permissions effectives.
- Un utilisateur ne peut pas s'accorder ses propres permissions.
- Les modifications de permissions sont auditées.
- Les actions Discord nécessitent à la fois permission Nexus et permission Discord appropriée.
- Vérifier les hiérarchies de rôles Discord et les limites de l'acteur.
- `guildId` provient d'une ressource vérifiée, pas d'une confiance aveugle dans le navigateur.
- Tester systématiquement les accès croisés entre guilds.

## 5. Décision en cas de conflit
Pour la première version : refus explicite prioritaire sur autorisation, sauf pour Owner dont les droits système sont définis et audités. La logique doit être centralisée dans un service d'autorisation et testée. Ne duplique pas des règles d'accès dans les contrôleurs.

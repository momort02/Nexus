# Nexus — Roadmap de développement

Toutes les fonctionnalités sont dans le périmètre produit. Les étapes organisent le développement, elles ne réduisent pas l'ambition finale.

## Étape 0 — Inspection et décisions
- Vérifier versions LTS de Node.js et compatibilité des dépendances.
- Initialiser monorepo pnpm.
- Ajouter TypeScript strict, lint, format et tests.
- Préparer Docker Compose.
- Écrire `.env.example` sans secret réel.

Critère de sortie : installation reproductible et commandes de validation documentées.

## Étape 1 — Fondations
- Express, PostgreSQL, Prisma et Redis.
- Gestion des erreurs.
- Sessions sécurisées.
- Health checks.
- Modèle User, Guild et association d'accès.
- Migrations et tests.

Critère : serveur démarre, migration fonctionne, tests passent.

## Étape 2 — OAuth2 et multi-tenant
- Flux Discord Authorization Code.
- Vérification `state`.
- Session et logout.
- Récupération des serveurs accessibles.
- Sélection d'un serveur.
- Middleware d'autorisation multi-tenant.
- Tests IDOR entre deux guilds.

Critère : un utilisateur ne peut jamais lire les données d'un espace non autorisé.

## Étape 3 — RBAC
- Catalogue des permissions.
- Rôles par défaut.
- Rôles personnalisés.
- Service d'autorisation central.
- Écrans de gestion.
- Audit des changements.

Critère : tests positifs et négatifs pour chaque rôle.

## Étape 4 — Bot Discord
- Installation et configuration.
- Gateway et intents strictement nécessaires.
- Synchronisation initiale.
- Arrivées/départs.
- Compteurs d'activité sans contenu de message.
- Déduplication et reprise après reconnexion.

Critère : les événements sont traités une seule fois logiquement et correctement isolés.

## Étape 5 — Dashboard et analytics
- Dashboard.
- Agrégats quotidiens.
- Graphiques.
- Filtres et exports.
- État du bot et qualité de collecte.

Critère : chaque indicateur a une définition et une période explicites.

## Étape 6 — StaffOS
- Profils staff.
- Équipes.
- Tâches.
- Candidatures.
- Signalements.
- Performance d'équipe.

Critère : workflows complets et autorisés.

## Étape 7 — Modération et audit
- Dossiers.
- Actions Discord autorisées.
- Hiérarchie des rôles.
- Contestations.
- Journal d'audit.

Critère : aucune action sensible sans double contrôle Nexus/Discord.

## Étape 8 — Notifications et intégrations
- Socket.IO.
- Notifications in-app.
- Jobs et rappels.
- Webhooks signés.
- API publique et documentation OpenAPI.

Critère : retries, révocation et limites documentés.

## Étape 9 — Durcissement et lancement
- Tests sécurité.
- Rate limiting.
- Sauvegarde et restauration.
- Monitoring.
- Politique de conservation.
- Documentation utilisateur.
- Déploiement HTTPS.

Critère : tests de restauration, sécurité et parcours de bout en bout validés.

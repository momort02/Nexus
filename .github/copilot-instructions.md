# Instructions globales — Nexus

Tu travailles sur Nexus, une plateforme web gratuite de gestion et d'analyse de serveurs Discord combinant ServerMetrics et StaffOS.

## Objectifs produit
- Gestion multi-serveurs, avec isolation stricte des données par `guildId`.
- Dashboard, analytics, membres, modération, staff, tâches, signalements, candidatures, notifications, paramètres, audit et API.
- Discord OAuth2 pour l'identité et la sélection des serveurs.
- Bot Discord pour collecter les événements autorisés et exécuter les actions explicitement demandées.
- Administrateurs et staff utilisent le produit avec des permissions configurables.
- Aucun abonnement ni fonctionnalité Premium.

## Stack
- Frontend : HTML/CSS/JavaScript natif, modules ES, sans React/Vue.
- Backend : Node.js + TypeScript + Express.
- Bot : Node.js + TypeScript + Discord.js.
- PostgreSQL + Prisma.
- Redis pour cache, files de tâches et coordination si nécessaire.
- Socket.IO pour les mises à jour temps réel.
- Zod pour valider les entrées.
- Vitest et Supertest pour les tests.
- Docker Compose pour le développement local.

Ne change pas cette stack sans expliquer la raison et demander confirmation.

## Architecture et qualité
- Respecte la structure existante et inspecte les fichiers avant de les modifier.
- Privilégie un monolithe modulaire avec séparation frontend, backend, bot et packages partagés.
- Utilise TypeScript côté serveur avec `strict: true`.
- Sépare routes, contrôleurs, services, dépôts de données, schémas et middleware.
- Évite les fichiers géants, la duplication et les abstractions inutiles.
- N'ajoute pas de dépendance sans justifier son utilité.
- Fournis des migrations Prisma cohérentes.
- Ajoute des tests pour les règles métier et les autorisations.
- Mets à jour la documentation lorsqu'une route, une permission, une table ou une variable d'environnement change.

## Sécurité obligatoire
- Toute route privée vérifie la session, l'accès au serveur ciblé et la permission requise côté backend.
- Ne fais jamais confiance à un `guildId`, rôle, identifiant ou permission fourni par le navigateur.
- Toutes les requêtes liées à un serveur sont filtrées par le `guildId` autorisé.
- Préviens les IDOR et les accès inter-serveurs.
- OAuth2 : vérifie `state`, utilise le flux Authorization Code, protège les sessions et ne journalise jamais les tokens.
- Secrets uniquement dans les variables d'environnement ou un gestionnaire de secrets.
- Cookies de session `HttpOnly`, `Secure` en production et `SameSite` adapté.
- Ajoute validation Zod, rate limiting, Helmet, contrôle CORS et protection CSRF adaptée à l'authentification par cookie.
- N'exécute jamais une action de modération sans permission Nexus, permission Discord suffisante et vérification des limites de hiérarchie Discord.
- Ne collecte pas le contenu des conversations. Pour les analytics, privilégie des compteurs agrégés.
- Les notes internes, candidatures et dossiers de modération sont privés et soumis à des permissions spécifiques.
- Prévois la minimisation, l'export et la suppression des données selon la politique de conservation.

## Discord
- Utilise les scopes OAuth2 strictement nécessaires : `identify` et `guilds` si la sélection des serveurs l'exige.
- Demande uniquement les permissions bot nécessaires aux fonctionnalités activées.
- Active uniquement les intents nécessaires. Les intents privilégiés doivent être activés dans le Developer Portal et peuvent nécessiter une approbation.
- Gère les erreurs API, les limites de débit, les reconnexions Gateway et les événements potentiellement dupliqués.
- Ne suppose pas que Discord fournit l'historique complet des messages. Les statistiques commencent à la mise en service du bot.
- Ne stocke pas le contenu des messages. Stocke les agrégats nécessaires, par serveur, salon et période, selon les autorisations configurées.

## UX et design
- Interface sombre professionnelle, bleu/violet, accessible et responsive.
- Palette : fond `#0B0D14`, sidebar `#10131D`, cartes `#171B29`, bordures `#262B3B`, bleu `#5865F2`, violet `#8B5CF6`, texte `#F4F5FA`, secondaire `#9299AD`.
- Interface française au départ, textes centralisés pour faciliter l'internationalisation.
- États chargement, vide, erreur, succès et accès refusé toujours prévus.
- Ne cache pas uniquement les contrôles interdits : protège aussi l'API.

## Façon de travailler
Avant chaque tâche :
1. Inspecte les fichiers concernés.
2. Résume le plan et les fichiers qui seront modifiés.
3. Signale les hypothèses et risques.
4. Implémente uniquement le périmètre demandé.
5. Lance les tests, le lint et le build disponibles.
6. Résume les changements, commandes exécutées et points restant à faire.

Ne prétends jamais qu'un test a réussi si tu ne l'as pas exécuté. N'invente pas de valeurs de configuration. Ne supprime pas de données ni de fichiers sans confirmation.

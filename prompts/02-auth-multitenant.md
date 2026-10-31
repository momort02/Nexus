# Prompt 02 — OAuth2 et multi-tenant

Lis les instructions globales et les documents d'architecture, permissions et base de données.

Implémente le flux Discord OAuth2 Authorization Code côté serveur :
- state anti-CSRF vérifié ;
- scopes minimaux `identify` et `guilds` si nécessaires ;
- échange du code côté backend ;
- session sécurisée ;
- logout ;
- endpoint `/api/v1/me` ;
- liste des serveurs accessibles ;
- sélection d'un serveur Nexus.

Crée le modèle de données nécessaire avec Prisma et des migrations.

Exigence majeure : isolation stricte entre guilds. Toute route doit vérifier que l'utilisateur a accès au guildId demandé. Ajoute des tests qui tentent d'accéder à la guild B depuis un compte autorisé uniquement sur la guild A.

N'expose jamais le client secret, les access tokens ou les refresh tokens au frontend. Ne stocke les tokens que si c'est réellement nécessaire, et chiffre-les au repos.

Inspecte le code existant, propose un plan, implémente seulement ce périmètre, exécute les tests et documente les variables d'environnement.

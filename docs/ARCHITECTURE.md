# Nexus — Architecture technique

## 1. Architecture cible
Monolithe modulaire composé de trois applications déployables :
- `apps/web` : frontend statique HTML/CSS/JS.
- `apps/api` : API Node.js, TypeScript et Express.
- `apps/bot` : bot Discord.js TypeScript.
Packages partagés :
- `packages/shared` : schémas Zod, constantes et contrats API non sensibles.

PostgreSQL est la source de vérité. Redis sert au cache, à la file de tâches et à la coordination si nécessaire. Socket.IO fournit les mises à jour temps réel.

## 2. Flux
1. L'utilisateur s'authentifie avec Discord OAuth2 Authorization Code.
2. L'API valide `state`, échange le code côté serveur et crée une session.
3. L'API récupère les guilds autorisés et permet la sélection d'un serveur.
4. Le bot installé sur le serveur reçoit les événements autorisés.
5. Les événements sont validés, dédupliqués et traités.
6. Les agrégats et événements métier sont stockés en base.
7. L'API expose les données après vérification des droits.
8. Socket.IO diffuse les changements autorisés aux clients du bon tenant.

## 3. Structure proposée
```text
nexus/
  apps/
    web/
      index.html
      src/
        pages/
        components/
        services/
        styles/
    api/
      src/
        config/
        middleware/
        modules/
        services/
        repositories/
        sockets/
        jobs/
        app.ts
        server.ts
      prisma/
        schema.prisma
        migrations/
      tests/
    bot/
      src/
        commands/
        events/
        handlers/
        services/
        transport/
        index.ts
  packages/
    shared/
      src/
        schemas/
        contracts/
        constants/
  docs/
  infra/
    nginx/
    docker/
  .github/
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
```

## 4. Modules backend
Chaque module suit autant que possible :
- `*.routes.ts`
- `*.controller.ts`
- `*.service.ts`
- `*.repository.ts`
- `*.schema.ts`
- `*.test.ts`

Ne crée pas systématiquement tous ces fichiers si le module est minuscule ; garde une structure proportionnée.

## 5. Temps réel
- Socket.IO est attaché au serveur HTTP de l’API ; le client réutilise le cookie
  de session Nexus.
- Vérifier l’expiration de session, l’accès au guildId et `dashboard.view` avant
  de rejoindre une room `guild:<id>`.
- Ne jamais accepter une room choisie par le client sans autorisation.
- Émettre uniquement un signal `guild:updated`, sans contenu métier ; le client
  relit les ressources via l’API autorisée.
- Revalider session, appartenance et permission avant chaque émission et quitter
  la room si l’accès a été révoqué.
- Prévoir reconnexion et rafraîchissement des données.

L’émission temps réel actuelle est en mémoire pour une instance API. Un
déploiement multi-instance doit configurer un adaptateur Socket.IO partagé
(Redis) avant d’attendre une diffusion entre instances.

## 6. Files de tâches
Utiliser Redis et un système de jobs adapté pour :
- notifications,
- rapports périodiques,
- synchronisations,
- exports.
Les jobs doivent être idempotents et avoir retries bornés, backoff et dead-letter/log d'échec.

## 7. Déploiement
Docker Compose en développement : web/API, bot, PostgreSQL, Redis et Nginx.
En production : HTTPS obligatoire, secrets injectés par l'environnement, sauvegardes hors machine, migrations contrôlées et health checks.

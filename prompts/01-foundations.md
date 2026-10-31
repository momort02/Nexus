# Prompt 01 — Fondations du monorepo

Tu es l'ingénieur principal du projet Nexus. Lis d'abord `.github/copilot-instructions.md` et les documents `docs/`.

Inspecte le dépôt avant de modifier quoi que ce soit. Si le dépôt contient déjà du code, ne l'écrase pas.

Objectif : créer uniquement les fondations du monorepo :
- pnpm workspace ;
- apps/web en HTML/CSS/JS natif ;
- apps/api en Node.js, TypeScript strict et Express ;
- apps/bot en Node.js, TypeScript strict et Discord.js ;
- packages/shared ;
- configuration lint, format et tests ;
- Docker Compose pour PostgreSQL et Redis ;
- `.env.example` avec noms et descriptions, sans secrets ;
- README avec commandes d'installation et de développement.

N'implémente pas encore OAuth2, les modules métier ni le dashboard final.

Avant de coder, donne un plan et les fichiers à créer. Ensuite implémente, lance les validations réellement disponibles et résume les résultats. Ne prétends pas qu'une commande a réussi si elle n'a pas été exécutée.

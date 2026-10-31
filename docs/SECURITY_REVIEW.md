# Revue de sécurité et préparation production

Revue du code présent le 31 octobre 2026. Le dépôt n’ayant pas de métadonnées
Git, la revue ne peut pas attribuer les constats à un diff ou vérifier
l’historique d’exposition de fichiers. Le contenu de `.env` n’a pas été
consulté.

## Constat corrigé

| Sévérité initiale | Zone                             | Constat initial                                                                                                                                                    | Correction                                                                                                                                                                                                                       |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moyenne           | Authentification interne bot/API | Une signature HMAC limitée à l’horodatage et au corps pouvait être rejouée sur un autre endpoint pendant cinq minutes ; le transport acceptait HTTP en production. | Les signatures couvrent maintenant méthode, chemin, horodatage, nonce UUID et corps. Le nonce est consommé atomiquement une fois en base, avec expiration après la fenêtre d’horloge. Les URLs HTTP sont refusées en production. |

Des tests couvrent les signatures valides, le rejeu du nonce, la séparation des
endpoints et la génération d’un nonce neuf à chaque tentative.

## Contrôles examinés

- **Secrets et OAuth** : tokens de session aléatoires stockés sous forme de
  hash ; cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production ; `state`
  OAuth comparé au cookie ; scopes `identify guilds`. `.env` est ignoré par
  `.gitignore`, mais son suivi et l’historique ne peuvent pas être vérifiés sans
  dépôt Git.
- **CSRF** : contrôle strict de l’origine sur les mutations web et vérification
  du `state` OAuth.
- **XSS** : les données UI examinées sont rendues via les API DOM et
  `textContent`, sans insertion HTML dynamique non échappée.
- **IDOR et permissions** : contrôles de session, membership par guild et RBAC
  côté API ; les accès socket sont également vérifiés à la connexion, à
  l’abonnement et avant une émission.
- **Rate limits** : OAuth sensible, API tenant, ingestion bot et worker
  disposent de limites ; les valeurs sont définies dans les routeurs.
- **Logs** : les logs inspectés excluent tokens, corps de requête et détails
  d’exception complets.
- **Migrations** : migrations Prisma versionnées présentes ; le dépôt
  fournit `prisma migrate deploy`.

## Points restant avant production

- Pas de procédure ni d’automatisation de sauvegarde/restauration PostgreSQL
  dans le dépôt. La restauration doit être testée régulièrement.
- TLS en terminaison, injection des secrets et processus de rollback des
  migrations ne sont pas établis par les fichiers présents.
- Le transport inter-instance Socket.IO est en mémoire ; un adaptateur Redis
  est requis pour diffuser entre plusieurs instances API.
- La correction HMAC anti-rejeu doit être déployée avec la migration Prisma
  avant la reprise du trafic bot ; les versions bot et API doivent être mises à
  jour ensemble.

Nexus **n’est pas déclaré prêt pour la production** tant que ces points ne sont
pas résolus et vérifiés dans l’environnement de déploiement.

## Vérifications exécutées

- `corepack pnpm test` — 33 tests réussis, répartis sur 7 fichiers.
- `corepack pnpm build` — build des packages partagé, web, API et bot réussi.
- `corepack pnpm typecheck` — TypeScript strict API, bot et package partagé
  réussi.
- `corepack pnpm lint` et `corepack pnpm format:check` — réussis.
- Vérification navigateur de la navigation et des vues : les 10 pages attendues
  sont présentes ; pas de débordement horizontal constaté aux largeurs 390 px
  et 1440 px.

La base PostgreSQL locale et les migrations n’ont pas été démarrées ni
restaurées dans le cadre de ces validations. La migration de stockage des
nonces doit être déployée avant de démarrer la nouvelle version de l’API.

---
applyTo: "apps/api/**/*.ts"
---

# Instructions backend Nexus

- TypeScript strict.
- Valide toutes les entrées externes avec Zod.
- Utilise des services pour les règles métier et des repositories pour l'accès aux données.
- Applique une authentification puis une autorisation par serveur et permission.
- Toutes les requêtes de données tenant doivent inclure le `guildId` autorisé.
- Utilise des transactions pour les opérations multi-table cohérentes.
- Réponds avec un format d'erreur API cohérent sans exposer stack traces ni secrets.
- Ajoute des tests d'autorisation, notamment les tentatives d'accès à un autre serveur.
- Ajoute rate limiting sur les routes sensibles.
- Ne journalise ni tokens OAuth, ni cookies, ni secrets, ni données personnelles inutiles.

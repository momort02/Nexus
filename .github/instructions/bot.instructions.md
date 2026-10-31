---
applyTo: "apps/bot/**/*.ts"
---

# Instructions bot Nexus

- Utilise Discord.js et TypeScript strict.
- Sépare commandes, événements, services Discord et transport vers l'API interne.
- Vérifie les permissions Discord et Nexus avant toute action sensible.
- Gère les erreurs REST, les limites de débit et les reconnexions Gateway.
- Rends les traitements idempotents lorsque c'est possible.
- Ne collecte pas le contenu des messages.
- Les compteurs d'activité doivent être agrégés et horodatés.
- Ne demande pas d'intents privilégiés sans fonctionnalité justifiée.
- Les secrets du bot sont exclusivement côté serveur.
- Ajoute des logs structurés sans token, contenu privé ou informations sensibles.

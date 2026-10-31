---
applyTo: "apps/web/**/*.{html,css,js}"
---

# Instructions frontend Nexus

- Utilise HTML sémantique, CSS moderne et JavaScript ES Modules.
- Pas de framework frontend.
- N'inclus aucun secret ni token bot dans le bundle navigateur.
- Centralise les appels HTTP dans un client API commun.
- Gère proprement 401, 403, 404, 429 et erreurs serveur.
- Ne considère jamais un élément masqué comme une protection d'accès.
- Échappe les contenus utilisateur avant insertion dans le DOM ; préfère `textContent` à `innerHTML`.
- Utilise des composants JS simples et réutilisables.
- Prévois navigation clavier, focus visible, contrastes et labels accessibles.
- Les graphiques doivent indiquer clairement période, unité, fuseau horaire et absence de données.
- Évite les chiffres fictifs dans l'interface réelle. Les données de démonstration doivent être explicitement signalées.

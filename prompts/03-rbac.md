# Prompt 03 — Moteur RBAC

À partir de `docs/PERMISSIONS.md`, implémente un moteur de permissions multi-tenant.

Attendus :
- catalogue central des permissions ;
- rôles par défaut ;
- rôles personnalisés ;
- attribution des rôles par guild ;
- service central `AuthorizationService` ;
- middleware Express réutilisable ;
- refus par défaut ;
- audit des modifications de permissions ;
- tests pour les rôles et les accès croisés entre guilds.

Ne te contente pas de masquer les boutons côté frontend. Toutes les vérifications doivent être effectuées côté backend. Vérifie aussi les permissions Discord avant les actions qui touchent Discord.

Présente ton plan avant modification et exécute les tests.

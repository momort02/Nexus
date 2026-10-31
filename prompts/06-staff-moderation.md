# Prompt 06 — StaffOS et modération

Implémente les modules Staff, Tasks, Reports, Applications, Moderation et Audit par étapes internes cohérentes.

Fonctions :
- profils staff et équipes ;
- tâches, échéances, commentaires et validation ;
- signalements et candidatures ;
- dossiers de modération ;
- avertissement, timeout, kick et ban uniquement si les permissions Nexus et Discord sont suffisantes ;
- contrôle de hiérarchie des rôles Discord ;
- contestations ;
- audit des actions sensibles ;
- notifications associées.

Toutes les données privées sont limitées aux permissions correspondantes. N'ajoute pas de système de notation opaque des modérateurs. Ajoute des tests d'autorisation et d'intégration.

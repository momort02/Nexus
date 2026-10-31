# Prompt 04 — Bot Discord et collecte

Implémente le bot Nexus avec Discord.js et TypeScript strict.

Périmètre :
- connexion Gateway ;
- commandes slash de diagnostic ;
- état de santé ;
- synchronisation des membres dans la limite des intents et permissions disponibles ;
- événements d'arrivée et de départ ;
- collecte de compteurs de messages agrégés sans stocker le contenu ;
- transport sécurisé vers l'API interne ou accès à une couche de service partagée clairement définie ;
- déduplication, retries bornés et gestion des reconnexions.

N'active pas d'intent privilégié sans justification précise. Documente les réglages du Developer Portal et les permissions d'installation. Ne mets aucun token dans le code. Prévois les cas où le bot n'a pas accès à un salon.

Les analytics ne doivent pas prétendre fournir l'historique antérieur à l'installation. Ajoute des tests des handlers et de la déduplication.

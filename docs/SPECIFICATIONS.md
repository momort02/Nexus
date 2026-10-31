# Nexus — Spécifications fonctionnelles

## 1. Vision
Nexus est une plateforme gratuite de gestion, d'analyse et d'organisation des serveurs Discord. Elle fusionne ServerMetrics et StaffOS. Elle s'adresse aux propriétaires, administrateurs et équipes de modération.

## 2. Principes
- Multi-tenant : chaque serveur Discord est un espace indépendant.
- Un compte utilisateur peut accéder à plusieurs espaces.
- Les rôles Nexus sont propres à chaque espace.
- Discord fournit l'identité et les événements autorisés ; Nexus conserve ses propres données métier.
- Pas de collecte du contenu des conversations.
- Les analytics historiques commencent à l'installation et à l'activation de la collecte.

## 3. Modules fonctionnels

### Dashboard
- Indicateurs : membres connus, arrivées/départs sur une période, volume de messages agrégé, dossiers ouverts, tâches en attente, état du bot.
- Flux d'événements récents autorisés.
- Widgets configurables par utilisateur.
- Filtres de période.

### Analytics
- Croissance des membres.
- Arrivées et départs.
- Volumes de messages agrégés par jour et salon.
- Activité horaire agrégée.
- Membres actifs selon une définition documentée.
- Comparaison de périodes.
- Export CSV.
- Aucune reconstitution d'historique antérieur à l'installation du bot.

### Members
- Liste synchronisée des membres selon les permissions et intents disponibles.
- Recherche par identifiant ou nom.
- Rôles et date d'arrivée si disponible.
- Fiche Nexus, notes internes protégées et dossiers associés.
- Pas de score opaque de comportement.

### Staff
- Profils internes liés à un utilisateur Discord.
- Équipes, fonctions et responsabilités.
- Affectation et historique des rôles Nexus.
- Disponibilités/planning facultatifs.
- Historique des interventions saisies ou déclenchées par Nexus.

### Moderation
- Dossiers de modération.
- Avertissements, timeout, kick et ban selon permissions.
- Motifs, auteur, date, statut et référence à l'action Discord.
- Signalements et contestations.
- Journal d'audit immuable au niveau applicatif.
- Contrôle des permissions et de la hiérarchie Discord avant exécution.

### Tasks
- Création, attribution, priorité, échéance et statut.
- Commentaires internes.
- Validation facultative par un responsable.
- Notifications et historique.

### Reports & Applications
- Formulaires configurables.
- Signalements.
- Candidatures staff.
- Statuts, assignation, commentaires et décisions.
- Accès restreint aux données privées.

### Staff Performance
- Volume d'interventions et tâches terminées.
- Délai de traitement calculé avec méthode explicite.
- Indicateurs agrégés d'équipe.
- Les métriques ne doivent pas être présentées comme une mesure absolue de qualité individuelle.

### Notifications & Automation
- Notifications in-app.
- Envoi de messages Discord configurables.
- Rappels de tâches.
- Alertes d'activité et de croissance.
- Webhooks sortants signés.
- Prévention des doublons et tentatives de livraison.

### Settings & API
- Configuration du serveur.
- Liaison des rôles Discord aux fonctions Nexus si utile.
- Rôles et permissions personnalisés.
- Paramètres de collecte et de conservation.
- Clés API révocables et limitées par scopes.
- Documentation OpenAPI.

### Audit Center
- Acteur, action, cible, date, serveur et métadonnées minimales.
- Consultation réservée.
- Journalisation des changements de permissions et actions sensibles.

### Server Health
- État de connexion du bot.
- Dernière synchronisation.
- Retard de traitement des événements.
- Tâches échouées.
- Indicateurs de qualité des données.

## 4. Rôles par défaut
- Owner : propriétaire de l'espace Nexus.
- Admin : administration générale, sans pouvoir supprimer/transférer la propriété.
- Head Staff : gestion de l'équipe et supervision.
- Moderator : fonctions de modération autorisées.
- Trial Moderator : fonctions limitées.
- Analyst : lecture des statistiques.
- Viewer : lecture des pages explicitement autorisées.

Les rôles sont personnalisables. Les permissions doivent être vérifiées côté serveur à chaque requête.

## 5. Exigences non fonctionnelles
- Responsive desktop et mobile.
- Accessibilité clavier et contrastes.
- Journalisation structurée.
- Sauvegardes PostgreSQL et tests de restauration.
- Gestion des erreurs Discord et rate limits.
- Isolation des tenants.
- Tests unitaires, intégration et autorisation.
- Politique de conservation documentée.
- Pas de fausses statistiques ni de données de démonstration présentées comme réelles.

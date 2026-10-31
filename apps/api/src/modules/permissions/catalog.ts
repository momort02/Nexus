export const PERMISSIONS = [
  'dashboard.view',
  'analytics.view',
  'analytics.export',
  'members.view',
  'members.notes.view',
  'members.notes.create',
  'members.notes.update',
  'members.notes.delete',
  'staff.view',
  'staff.manage',
  'staff.promote',
  'staff.assign',
  'moderation.view',
  'moderation.warn',
  'moderation.timeout',
  'moderation.kick',
  'moderation.ban',
  'moderation.appeals.view',
  'moderation.appeals.manage',
  'tasks.view',
  'tasks.create',
  'tasks.assign',
  'tasks.update',
  'tasks.complete',
  'tasks.validate',
  'reports.view',
  'reports.manage',
  'applications.view',
  'applications.review',
  'notifications.manage',
  'settings.view',
  'settings.manage',
  'permissions.view',
  'permissions.manage',
  'audit.view',
  'api_keys.manage',
  'server.delete',
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];
export type PermissionEffect = 'ALLOW' | 'DENY';

export interface DefaultRole {
  key: string;
  name: string;
  rank: number;
  permissionEffects: Partial<Record<PermissionKey, PermissionEffect>>;
}

const allow = (...permissions: PermissionKey[]) =>
  Object.fromEntries(
    permissions.map((permission) => [permission, 'ALLOW' as const]),
  );

const allPermissions = [...PERMISSIONS];
const adminPermissions = PERMISSIONS.filter(
  (permission) => permission !== 'server.delete',
);
const headStaffPermissions = PERMISSIONS.filter(
  (permission) =>
    permission.startsWith('staff.') ||
    permission.startsWith('tasks.') ||
    permission.startsWith('reports.') ||
    permission.startsWith('applications.') ||
    permission === 'moderation.view' ||
    permission.startsWith('moderation.appeals.') ||
    permission === 'dashboard.view',
);

export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    key: 'OWNER',
    name: 'Owner',
    rank: 100,
    permissionEffects: allow(...allPermissions),
  },
  {
    key: 'ADMIN',
    name: 'Admin',
    rank: 80,
    permissionEffects: allow(...adminPermissions),
  },
  {
    key: 'HEAD_STAFF',
    name: 'Head Staff',
    rank: 60,
    permissionEffects: allow(...headStaffPermissions),
  },
  {
    key: 'MODERATOR',
    name: 'Moderator',
    rank: 40,
    permissionEffects: allow(
      'dashboard.view',
      'members.view',
      'moderation.view',
      'moderation.warn',
      'moderation.timeout',
      'reports.view',
      'tasks.view',
      'tasks.complete',
    ),
  },
  {
    key: 'TRIAL_MODERATOR',
    name: 'Trial Moderator',
    rank: 30,
    permissionEffects: allow(
      'dashboard.view',
      'members.view',
      'moderation.view',
      'reports.view',
    ),
  },
  {
    key: 'ANALYST',
    name: 'Analyst',
    rank: 20,
    permissionEffects: allow(
      'dashboard.view',
      'analytics.view',
      'analytics.export',
    ),
  },
  {
    key: 'VIEWER',
    name: 'Viewer',
    rank: 10,
    permissionEffects: allow('dashboard.view'),
  },
];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'dashboard.view': 'Consulter le tableau de bord.',
  'analytics.view': 'Consulter les analyses.',
  'analytics.export': 'Exporter les analyses.',
  'members.view': 'Consulter les membres.',
  'members.notes.view': 'Consulter les notes internes des membres.',
  'members.notes.create': 'Créer des notes internes pour les membres.',
  'members.notes.update': 'Modifier les notes internes des membres.',
  'members.notes.delete': 'Supprimer les notes internes des membres.',
  'staff.view': "Consulter l'équipe staff.",
  'staff.manage': "Gérer l'équipe staff.",
  'staff.promote': 'Promouvoir un membre du staff.',
  'staff.assign': 'Attribuer des responsabilités au staff.',
  'moderation.view': 'Consulter les dossiers de modération.',
  'moderation.warn': 'Avertir un membre.',
  'moderation.timeout': 'Appliquer un timeout.',
  'moderation.kick': 'Expulser un membre.',
  'moderation.ban': 'Bannir un membre.',
  'moderation.appeals.view': 'Consulter les contestations.',
  'moderation.appeals.manage': 'Traiter les contestations.',
  'tasks.view': 'Consulter les tâches.',
  'tasks.create': 'Créer des tâches.',
  'tasks.assign': 'Attribuer des tâches.',
  'tasks.update': 'Modifier les tâches.',
  'tasks.complete': 'Terminer les tâches.',
  'tasks.validate': 'Valider les tâches.',
  'reports.view': 'Consulter les signalements.',
  'reports.manage': 'Gérer les signalements.',
  'applications.view': 'Consulter les candidatures.',
  'applications.review': 'Examiner les candidatures.',
  'notifications.manage': 'Gérer les notifications.',
  'settings.view': 'Consulter les paramètres.',
  'settings.manage': 'Modifier les paramètres.',
  'permissions.view': 'Consulter les rôles et permissions.',
  'permissions.manage': 'Gérer les rôles, permissions et attributions.',
  'audit.view': "Consulter le journal d'audit.",
  'api_keys.manage': 'Gérer les clés API.',
  'server.delete': 'Supprimer le serveur Nexus.',
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}

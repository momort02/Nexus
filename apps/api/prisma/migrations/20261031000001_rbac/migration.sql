-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateTable
CREATE TABLE "GuildRole" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "effect" "PermissionEffect" NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateTable
CREATE TABLE "UserGuildRole" (
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGuildRole_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateTable
CREATE TABLE "PermissionAuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "roleId" TEXT,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuildRole_guildId_rank_idx" ON "GuildRole"("guildId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "GuildRole_guildId_key_key" ON "GuildRole"("guildId", "key");

-- CreateIndex
CREATE INDEX "RolePermission_permissionKey_idx" ON "RolePermission"("permissionKey");

-- CreateIndex
CREATE INDEX "UserGuildRole_roleId_idx" ON "UserGuildRole"("roleId");

-- CreateIndex
CREATE INDEX "PermissionAuditLog_guildId_createdAt_idx" ON "PermissionAuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "PermissionAuditLog_actorUserId_createdAt_idx" ON "PermissionAuditLog"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuildRole" ADD CONSTRAINT "GuildRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GuildRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGuildRole" ADD CONSTRAINT "UserGuildRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "GuildMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGuildRole" ADD CONSTRAINT "UserGuildRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GuildRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionAuditLog" ADD CONSTRAINT "PermissionAuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the permission catalog and protected role templates for existing guilds.
INSERT INTO "Permission" ("key", "description") VALUES
    ('dashboard.view', 'Consulter le tableau de bord.'),
    ('analytics.view', 'Consulter les analyses.'),
    ('analytics.export', 'Exporter les analyses.'),
    ('members.view', 'Consulter les membres.'),
    ('members.notes.view', 'Consulter les notes internes des membres.'),
    ('members.notes.create', 'Créer des notes internes pour les membres.'),
    ('members.notes.update', 'Modifier les notes internes des membres.'),
    ('members.notes.delete', 'Supprimer les notes internes des membres.'),
    ('staff.view', 'Consulter l''équipe staff.'),
    ('staff.manage', 'Gérer l''équipe staff.'),
    ('staff.promote', 'Promouvoir un membre du staff.'),
    ('staff.assign', 'Attribuer des responsabilités au staff.'),
    ('moderation.view', 'Consulter les dossiers de modération.'),
    ('moderation.warn', 'Avertir un membre.'),
    ('moderation.timeout', 'Appliquer un timeout.'),
    ('moderation.kick', 'Expulser un membre.'),
    ('moderation.ban', 'Bannir un membre.'),
    ('moderation.appeals.view', 'Consulter les contestations.'),
    ('moderation.appeals.manage', 'Traiter les contestations.'),
    ('tasks.view', 'Consulter les tâches.'),
    ('tasks.create', 'Créer des tâches.'),
    ('tasks.assign', 'Attribuer des tâches.'),
    ('tasks.update', 'Modifier les tâches.'),
    ('tasks.complete', 'Terminer les tâches.'),
    ('tasks.validate', 'Valider les tâches.'),
    ('reports.view', 'Consulter les signalements.'),
    ('reports.manage', 'Gérer les signalements.'),
    ('applications.view', 'Consulter les candidatures.'),
    ('applications.review', 'Examiner les candidatures.'),
    ('notifications.manage', 'Gérer les notifications.'),
    ('settings.view', 'Consulter les paramètres.'),
    ('settings.manage', 'Modifier les paramètres.'),
    ('permissions.view', 'Consulter les rôles et permissions.'),
    ('permissions.manage', 'Gérer les rôles, permissions et attributions.'),
    ('audit.view', 'Consulter le journal d''audit.'),
    ('api_keys.manage', 'Gérer les clés API.'),
    ('server.delete', 'Supprimer le serveur Nexus.')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "GuildRole" (
    "id", "guildId", "key", "name", "rank", "isSystem", "createdAt", "updatedAt"
)
SELECT
    "Guild"."id" || ':' || defaults."key",
    "Guild"."id",
    defaults."key",
    defaults."name",
    defaults."rank",
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Guild"
CROSS JOIN (VALUES
    ('OWNER', 'Owner', 100),
    ('ADMIN', 'Admin', 80),
    ('HEAD_STAFF', 'Head Staff', 60),
    ('MODERATOR', 'Moderator', 40),
    ('TRIAL_MODERATOR', 'Trial Moderator', 30),
    ('ANALYST', 'Analyst', 20),
    ('VIEWER', 'Viewer', 10)
) AS defaults("key", "name", "rank")
ON CONFLICT ("guildId", "key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionKey", "effect")
SELECT role."id", permission."key", 'ALLOW'::"PermissionEffect"
FROM "GuildRole" AS role
CROSS JOIN "Permission" AS permission
WHERE role."isSystem" = TRUE
  AND (
    role."key" = 'OWNER'
    OR (role."key" = 'ADMIN' AND permission."key" <> 'server.delete')
    OR (
      role."key" = 'HEAD_STAFF'
      AND (
        permission."key" LIKE 'staff.%'
        OR permission."key" LIKE 'tasks.%'
        OR permission."key" LIKE 'reports.%'
        OR permission."key" LIKE 'applications.%'
        OR permission."key" = 'moderation.view'
        OR permission."key" LIKE 'moderation.appeals.%'
        OR permission."key" = 'dashboard.view'
      )
    )
    OR (
      role."key" = 'MODERATOR'
      AND permission."key" IN (
        'dashboard.view',
        'members.view',
        'moderation.view',
        'moderation.warn',
        'moderation.timeout',
        'reports.view',
        'tasks.view',
        'tasks.complete'
      )
    )
    OR (
      role."key" = 'TRIAL_MODERATOR'
      AND permission."key" IN (
        'dashboard.view',
        'members.view',
        'moderation.view',
        'reports.view'
      )
    )
    OR (
      role."key" = 'ANALYST'
      AND permission."key" IN (
        'dashboard.view',
        'analytics.view',
        'analytics.export'
      )
    )
    OR (
      role."key" = 'VIEWER'
      AND permission."key" = 'dashboard.view'
    )
  )
ON CONFLICT ("roleId", "permissionKey") DO NOTHING;

INSERT INTO "UserGuildRole" ("membershipId", "roleId")
SELECT membership."id", role."id"
FROM "GuildMembership" AS membership
JOIN "GuildRole" AS role
  ON role."guildId" = membership."guildId"
  AND role."key" = 'OWNER'
WHERE membership."role" = 'OWNER'
ON CONFLICT ("membershipId", "roleId") DO NOTHING;

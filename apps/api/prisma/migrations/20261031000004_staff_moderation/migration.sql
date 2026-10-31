CREATE TYPE "StaffTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'VALIDATED');
CREATE TYPE "StaffItemStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'CLOSED');
CREATE TYPE "ModerationActionType" AS ENUM ('WARN', 'TIMEOUT', 'KICK', 'BAN');
CREATE TYPE "ModerationCaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'APPEALED', 'REVERSED');
CREATE TYPE "ModerationAppealStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED');
CREATE TYPE "ModerationJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StaffTeam" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffTeam_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StaffTeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffTeamMember_pkey" PRIMARY KEY ("teamId", "userId")
);
CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "StaffTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "createdBy" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StaffTaskComment" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffTaskComment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StaffReport" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetDiscordId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" "StaffItemStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffReport_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StaffApplication" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "applicantDiscordId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "status" "StaffItemStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffApplication_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetDiscordId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "action" "ModerationActionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "status" "ModerationCaseStatus" NOT NULL DEFAULT 'PENDING',
    "resultMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ModerationAppeal" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "appellantId" TEXT NOT NULL,
    "appellantDiscordId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ModerationAppealStatus" NOT NULL DEFAULT 'OPEN',
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModerationAppeal_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" "ModerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffProfile_guildId_userId_key" ON "StaffProfile"("guildId", "userId");
CREATE INDEX "StaffProfile_guildId_active_idx" ON "StaffProfile"("guildId", "active");
CREATE UNIQUE INDEX "StaffTeam_guildId_name_key" ON "StaffTeam"("guildId", "name");
CREATE INDEX "StaffTeam_guildId_createdAt_idx" ON "StaffTeam"("guildId", "createdAt");
CREATE INDEX "StaffTeamMember_userId_idx" ON "StaffTeamMember"("userId");
CREATE INDEX "StaffTask_guildId_status_createdAt_idx" ON "StaffTask"("guildId", "status", "createdAt");
CREATE INDEX "StaffTask_guildId_assigneeId_dueAt_idx" ON "StaffTask"("guildId", "assigneeId", "dueAt");
CREATE INDEX "StaffTaskComment_guildId_taskId_createdAt_idx" ON "StaffTaskComment"("guildId", "taskId", "createdAt");
CREATE INDEX "StaffReport_guildId_status_createdAt_idx" ON "StaffReport"("guildId", "status", "createdAt");
CREATE INDEX "StaffApplication_guildId_status_createdAt_idx" ON "StaffApplication"("guildId", "status", "createdAt");
CREATE INDEX "ModerationCase_guildId_targetDiscordId_createdAt_idx" ON "ModerationCase"("guildId", "targetDiscordId", "createdAt");
CREATE INDEX "ModerationCase_guildId_status_createdAt_idx" ON "ModerationCase"("guildId", "status", "createdAt");
CREATE UNIQUE INDEX "ModerationAppeal_caseId_key" ON "ModerationAppeal"("caseId");
CREATE INDEX "ModerationAppeal_guildId_status_createdAt_idx" ON "ModerationAppeal"("guildId", "status", "createdAt");
CREATE UNIQUE INDEX "ModerationAction_caseId_key" ON "ModerationAction"("caseId");
CREATE INDEX "ModerationAction_status_createdAt_idx" ON "ModerationAction"("status", "createdAt");
CREATE INDEX "ModerationAction_guildId_status_idx" ON "ModerationAction"("guildId", "status");
CREATE INDEX "AuditEvent_guildId_createdAt_idx" ON "AuditEvent"("guildId", "createdAt");
CREATE INDEX "Notification_guildId_userId_readAt_createdAt_idx" ON "Notification"("guildId", "userId", "readAt", "createdAt");

ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffTeam" ADD CONSTRAINT "StaffTeam_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffTeamMember" ADD CONSTRAINT "StaffTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StaffTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffTaskComment" ADD CONSTRAINT "StaffTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StaffTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffReport" ADD CONSTRAINT "StaffReport_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffApplication" ADD CONSTRAINT "StaffApplication_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationAppeal" ADD CONSTRAINT "ModerationAppeal_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

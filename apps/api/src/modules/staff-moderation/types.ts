import type {
  ModerationActionType,
  ModerationAppealStatus,
  ModerationJobStatus,
  StaffItemStatus,
  StaffTaskStatus,
} from '@prisma/client';

export interface StaffModerationRepository {
  listMembers(input: {
    guildId: string;
    page: number;
    pageSize: number;
    search?: string;
    roleId?: string;
  }): Promise<{
    members: Array<{
      discordUserId: string;
      displayName: string | null;
      joinedAt: Date | null;
      roleIds: string[];
      syncedAt: Date;
    }>;
    total: number;
  }>;
  listStaff(guildId: string): Promise<unknown[]>;
  upsertStaff(input: {
    guildId: string;
    userId: string;
    title: string | null;
    active: boolean;
    actorUserId: string;
  }): Promise<unknown>;
  listTeams(guildId: string): Promise<unknown[]>;
  createTeam(input: {
    guildId: string;
    name: string;
    description: string | null;
    actorUserId: string;
  }): Promise<unknown>;
  addTeamMember(input: {
    guildId: string;
    teamId: string;
    userId: string;
    actorUserId: string;
  }): Promise<boolean>;
  listTasks(guildId: string): Promise<unknown[]>;
  createTask(input: {
    guildId: string;
    actorUserId: string;
    title: string;
    description: string;
    assigneeId: string | null;
    dueAt: Date | null;
  }): Promise<unknown>;
  updateTask(input: {
    guildId: string;
    taskId: string;
    actorUserId: string;
    status?: StaffTaskStatus;
    comment?: string;
  }): Promise<unknown | null>;
  listReports(guildId: string): Promise<unknown[]>;
  createReport(input: {
    guildId: string;
    reporterId: string;
    targetDiscordId: string;
    category: string;
    details: string;
  }): Promise<unknown>;
  updateReport(input: {
    guildId: string;
    reportId: string;
    actorUserId: string;
    status: StaffItemStatus;
    assignedTo: string | null;
  }): Promise<unknown | null>;
  listApplications(guildId: string): Promise<unknown[]>;
  createApplication(input: {
    guildId: string;
    applicantId: string;
    applicantDiscordId: string;
    answers: Record<string, string>;
  }): Promise<unknown>;
  updateApplication(input: {
    guildId: string;
    applicationId: string;
    actorUserId: string;
    status: StaffItemStatus;
  }): Promise<unknown | null>;
  listCases(guildId: string): Promise<unknown[]>;
  createModerationCase(input: {
    guildId: string;
    actorUserId: string;
    actorDiscordId: string;
    targetDiscordId: string;
    action: ModerationActionType;
    reason: string;
    durationSeconds: number | null;
  }): Promise<unknown>;
  createAppeal(input: {
    guildId: string;
    caseId: string;
    appellantId: string;
    appellantDiscordId: string;
    message: string;
  }): Promise<unknown | null>;
  listAppeals(guildId: string): Promise<unknown[]>;
  updateAppeal(input: {
    guildId: string;
    appealId: string;
    actorUserId: string;
    status: Exclude<ModerationAppealStatus, 'OPEN'>;
  }): Promise<unknown | null>;
  listAudit(guildId: string, limit: number): Promise<unknown[]>;
  listNotifications(guildId: string, userId: string): Promise<unknown[]>;
  markNotificationRead(
    guildId: string,
    userId: string,
    notificationId: string,
  ): Promise<boolean>;
  claimModerationActions(): Promise<
    Array<{
      id: string;
      guildId: string;
      caseId: string;
      status: ModerationJobStatus;
      case: {
        targetDiscordId: string;
        actorUserId: string;
        actorDiscordId: string;
        action: ModerationActionType;
        reason: string;
        durationSeconds: number | null;
      };
    }>
  >;
  completeModerationAction(input: {
    id: string;
    success: boolean;
    message: string;
  }): Promise<boolean>;
}

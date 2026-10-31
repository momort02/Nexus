import {
  ModerationCaseStatus,
  ModerationJobStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { StaffModerationRepository } from './types.js';

type Transaction = Prisma.TransactionClient;

async function writeAudit(
  transaction: Transaction,
  input: {
    guildId: string;
    actorUserId: string;
    action: string;
    subjectType: string;
    subjectId?: string;
    details?: Prisma.InputJsonObject;
  },
): Promise<void> {
  await transaction.auditEvent.create({
    data: {
      ...input,
      details: input.details ?? {},
    },
  });
}

async function requireActiveStaff(
  transaction: Transaction,
  guildId: string,
  userId: string,
): Promise<boolean> {
  return Boolean(
    await transaction.staffProfile.findFirst({
      where: { guildId, userId, active: true },
      select: { id: true },
    }),
  );
}

export class PrismaStaffModerationRepository implements StaffModerationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listMembers(input: {
    guildId: string;
    page: number;
    pageSize: number;
    search?: string;
    roleId?: string;
  }) {
    const where: Prisma.GuildMemberSnapshotWhereInput = {
      guildId: input.guildId,
      ...(input.search
        ? {
            OR: [
              { discordUserId: { contains: input.search } },
              {
                displayName: {
                  contains: input.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
      ...(input.roleId ? { roleIds: { array_contains: [input.roleId] } } : {}),
    };
    const [members, total] = await this.prisma.$transaction([
      this.prisma.guildMemberSnapshot.findMany({
        where,
        select: {
          discordUserId: true,
          displayName: true,
          joinedAt: true,
          roleIds: true,
          syncedAt: true,
        },
        orderBy: { discordUserId: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.guildMemberSnapshot.count({ where }),
    ]);

    return {
      members: members.map((member) => ({
        ...member,
        roleIds: Array.isArray(member.roleIds)
          ? member.roleIds.filter(
              (roleId): roleId is string => typeof roleId === 'string',
            )
          : [],
      })),
      total,
    };
  }

  listStaff(guildId: string): Promise<unknown[]> {
    return this.prisma.staffProfile.findMany({
      where: { guildId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async upsertStaff(input: {
    guildId: string;
    userId: string;
    title: string | null;
    active: boolean;
    actorUserId: string;
  }): Promise<unknown> {
    return this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.guildMembership.findUnique({
        where: {
          userId_guildId: { userId: input.userId, guildId: input.guildId },
        },
        select: { id: true },
      });
      if (!membership) {
        return null;
      }

      const profile = await transaction.staffProfile.upsert({
        where: {
          guildId_userId: {
            guildId: input.guildId,
            userId: input.userId,
          },
        },
        create: {
          guildId: input.guildId,
          userId: input.userId,
          title: input.title,
          active: input.active,
        },
        update: { title: input.title, active: input.active },
      });
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: 'STAFF_PROFILE_UPDATED',
        subjectType: 'staff_profile',
        subjectId: profile.id,
        details: { userId: input.userId, active: input.active },
      });
      return profile;
    });
  }

  listTeams(guildId: string): Promise<unknown[]> {
    return this.prisma.staffTeam.findMany({
      where: { guildId },
      include: { members: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createTeam(input: {
    guildId: string;
    name: string;
    description: string | null;
    actorUserId: string;
  }): Promise<unknown> {
    return this.prisma.$transaction(async (transaction) => {
      const team = await transaction.staffTeam.create({
        data: {
          guildId: input.guildId,
          name: input.name,
          description: input.description,
        },
      });
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: 'STAFF_TEAM_CREATED',
        subjectType: 'staff_team',
        subjectId: team.id,
      });
      return team;
    });
  }

  async addTeamMember(input: {
    guildId: string;
    teamId: string;
    userId: string;
    actorUserId: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const team = await transaction.staffTeam.findFirst({
        where: { id: input.teamId, guildId: input.guildId },
        select: { id: true },
      });
      if (
        !team ||
        !(await requireActiveStaff(transaction, input.guildId, input.userId))
      ) {
        return false;
      }
      await transaction.staffTeamMember.create({
        data: { teamId: team.id, userId: input.userId },
      });
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: 'STAFF_TEAM_MEMBER_ADDED',
        subjectType: 'staff_team',
        subjectId: team.id,
        details: { userId: input.userId },
      });
      return true;
    });
  }

  listTasks(guildId: string): Promise<unknown[]> {
    return this.prisma.staffTask.findMany({
      where: { guildId },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createTask(input: {
    guildId: string;
    actorUserId: string;
    title: string;
    description: string;
    assigneeId: string | null;
    dueAt: Date | null;
  }): Promise<unknown | null> {
    return this.prisma.$transaction(async (transaction) => {
      if (
        input.assigneeId &&
        !(await requireActiveStaff(
          transaction,
          input.guildId,
          input.assigneeId,
        ))
      ) {
        return null;
      }
      const task = await transaction.staffTask.create({
        data: {
          guildId: input.guildId,
          createdBy: input.actorUserId,
          title: input.title,
          description: input.description,
          assigneeId: input.assigneeId,
          dueAt: input.dueAt,
        },
      });
      if (input.assigneeId) {
        await transaction.notification.create({
          data: {
            guildId: input.guildId,
            userId: input.assigneeId,
            type: 'task.assigned',
            message: `Une tâche vous a été attribuée : ${input.title}`,
          },
        });
      }
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: 'TASK_CREATED',
        subjectType: 'task',
        subjectId: task.id,
      });
      return task;
    });
  }

  async updateTask(input: {
    guildId: string;
    taskId: string;
    actorUserId: string;
    status?: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'VALIDATED';
    comment?: string;
  }): Promise<unknown | null> {
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.staffTask.findFirst({
        where: { id: input.taskId, guildId: input.guildId },
      });
      if (!task) {
        return null;
      }
      if (input.comment) {
        const comment = await transaction.staffTaskComment.create({
          data: {
            guildId: input.guildId,
            taskId: task.id,
            authorId: input.actorUserId,
            content: input.comment,
          },
        });
        await writeAudit(transaction, {
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          action: 'TASK_COMMENT_ADDED',
          subjectType: 'task',
          subjectId: task.id,
          details: { commentId: comment.id },
        });
      }
      const updated = await transaction.staffTask.update({
        where: { id: task.id },
        data: input.status ? { status: input.status } : {},
        include: { comments: { orderBy: { createdAt: 'asc' } } },
      });
      if (input.status) {
        await writeAudit(transaction, {
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          action: 'TASK_STATUS_UPDATED',
          subjectType: 'task',
          subjectId: task.id,
          details: { status: input.status },
        });
      }
      const recipients = [task.assigneeId, task.createdBy].filter(
        (userId, index, values): userId is string =>
          userId !== null &&
          userId !== input.actorUserId &&
          values.indexOf(userId) === index,
      );
      if (input.comment || input.status) {
        await transaction.notification.createMany({
          data: recipients.map((userId) => ({
            guildId: input.guildId,
            userId,
            type: 'task.updated',
            message: `La tâche « ${task.title} » a été mise à jour.`,
          })),
        });
      }
      return updated;
    });
  }

  listReports(guildId: string): Promise<unknown[]> {
    return this.prisma.staffReport.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  createReport(input: {
    guildId: string;
    reporterId: string;
    targetDiscordId: string;
    category: string;
    details: string;
  }): Promise<unknown> {
    return this.prisma.$transaction(async (transaction) => {
      const report = await transaction.staffReport.create({
        data: input,
      });
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.reporterId,
        action: 'REPORT_CREATED',
        subjectType: 'report',
        subjectId: report.id,
      });
      const staff = await transaction.staffProfile.findMany({
        where: { guildId: input.guildId, active: true },
        select: { userId: true },
      });
      if (staff.length > 0) {
        await transaction.notification.createMany({
          data: staff.map(({ userId }) => ({
            guildId: input.guildId,
            userId,
            type: 'report.created',
            message: 'Un nouveau signalement a été déposé.',
          })),
        });
      }
      return report;
    });
  }

  async updateReport(input: {
    guildId: string;
    reportId: string;
    actorUserId: string;
    status: 'OPEN' | 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';
    assignedTo: string | null;
  }): Promise<unknown | null> {
    return this.prisma.$transaction(async (transaction) => {
      const report = await transaction.staffReport.findFirst({
        where: { id: input.reportId, guildId: input.guildId },
      });
      if (!report) {
        return null;
      }
      if (
        input.assignedTo &&
        !(await requireActiveStaff(
          transaction,
          input.guildId,
          input.assignedTo,
        ))
      ) {
        return null;
      }
      const updated = await transaction.staffReport.update({
        where: { id: report.id },
        data: { status: input.status, assignedTo: input.assignedTo },
      });
      if (input.assignedTo) {
        await transaction.notification.create({
          data: {
            guildId: input.guildId,
            userId: input.assignedTo,
            type: 'report.assigned',
            message: 'Un signalement vous a été attribué.',
          },
        });
      }
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: 'REPORT_UPDATED',
        subjectType: 'report',
        subjectId: report.id,
        details: { status: input.status },
      });
      return updated;
    });
  }

  listApplications(guildId: string): Promise<unknown[]> {
    return this.prisma.staffApplication.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  createApplication(input: {
    guildId: string;
    applicantId: string;
    applicantDiscordId: string;
    answers: Record<string, string>;
  }): Promise<unknown> {
    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.staffApplication.create({
        data: { ...input, answers: input.answers },
      });
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.applicantId,
        action: 'APPLICATION_SUBMITTED',
        subjectType: 'application',
        subjectId: application.id,
      });
      const staff = await transaction.staffProfile.findMany({
        where: { guildId: input.guildId, active: true },
        select: { userId: true },
      });
      if (staff.length > 0) {
        await transaction.notification.createMany({
          data: staff.map(({ userId }) => ({
            guildId: input.guildId,
            userId,
            type: 'application.created',
            message: 'Une nouvelle candidature a été déposée.',
          })),
        });
      }
      return application;
    });
  }

  async updateApplication(input: {
    guildId: string;
    applicationId: string;
    actorUserId: string;
    status: 'OPEN' | 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';
  }): Promise<unknown | null> {
    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.staffApplication.findFirst({
        where: { id: input.applicationId, guildId: input.guildId },
      });
      if (!application) {
        return null;
      }
      const updated = await transaction.staffApplication.update({
        where: { id: application.id },
        data: { status: input.status, reviewedBy: input.actorUserId },
      });
      await transaction.notification.create({
        data: {
          guildId: input.guildId,
          userId: application.applicantId,
          type: 'application.reviewed',
          message: `Votre candidature a été mise à jour : ${input.status.toLowerCase()}.`,
        },
      });
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: 'APPLICATION_REVIEWED',
        subjectType: 'application',
        subjectId: application.id,
        details: { status: input.status },
      });
      return updated;
    });
  }

  listCases(guildId: string): Promise<unknown[]> {
    return this.prisma.moderationCase.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createModerationCase(input: {
    guildId: string;
    actorUserId: string;
    actorDiscordId: string;
    targetDiscordId: string;
    action: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN';
    reason: string;
    durationSeconds: number | null;
  }): Promise<unknown> {
    return this.prisma.$transaction(async (transaction) => {
      const moderationCase = await transaction.moderationCase.create({
        data: { ...input, status: ModerationCaseStatus.PENDING },
      });
      await transaction.moderationAction.create({
        data: { guildId: input.guildId, caseId: moderationCase.id },
      });
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: 'MODERATION_ACTION_REQUESTED',
        subjectType: 'moderation_case',
        subjectId: moderationCase.id,
        details: {
          action: input.action,
          targetDiscordId: input.targetDiscordId,
        },
      });
      return moderationCase;
    });
  }

  async createAppeal(input: {
    guildId: string;
    caseId: string;
    appellantId: string;
    appellantDiscordId: string;
    message: string;
  }): Promise<unknown | null> {
    return this.prisma.$transaction(async (transaction) => {
      const existingAppeal = await transaction.moderationAppeal.findUnique({
        where: { caseId: input.caseId },
        select: { id: true },
      });
      if (existingAppeal) {
        return null;
      }
      const moderationCase = await transaction.moderationCase.findFirst({
        where: {
          id: input.caseId,
          guildId: input.guildId,
          targetDiscordId: input.appellantDiscordId,
          status: { in: ['COMPLETED', 'APPEALED'] },
        },
      });
      if (!moderationCase) {
        return null;
      }
      const created = await transaction.moderationAppeal.createMany({
        data: input,
        skipDuplicates: true,
      });
      if (created.count === 0) {
        return null;
      }
      const appeal = await transaction.moderationAppeal.findUnique({
        where: { caseId: input.caseId },
      });
      if (!appeal) {
        throw new Error('The appeal was not persisted.');
      }
      await transaction.moderationCase.update({
        where: { id: moderationCase.id },
        data: { status: 'APPEALED' },
      });
      await transaction.notification.create({
        data: {
          guildId: input.guildId,
          userId: moderationCase.actorUserId,
          type: 'moderation.appeal',
          message:
            'Une contestation a été déposée sur un dossier de modération.',
        },
      });
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.appellantId,
        action: 'MODERATION_APPEAL_CREATED',
        subjectType: 'moderation_appeal',
        subjectId: appeal.id,
      });
      return appeal;
    });
  }

  listAppeals(guildId: string): Promise<unknown[]> {
    return this.prisma.moderationAppeal.findMany({
      where: { guildId },
      include: { case: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateAppeal(input: {
    guildId: string;
    appealId: string;
    actorUserId: string;
    status: 'ACCEPTED' | 'REJECTED';
  }): Promise<unknown | null> {
    return this.prisma.$transaction(async (transaction) => {
      const appeal = await transaction.moderationAppeal.findFirst({
        where: {
          id: input.appealId,
          guildId: input.guildId,
          status: 'OPEN',
        },
      });
      if (!appeal) {
        return null;
      }
      const changed = await transaction.moderationAppeal.updateMany({
        where: {
          id: appeal.id,
          guildId: input.guildId,
          status: 'OPEN',
        },
        data: { status: input.status, handledBy: input.actorUserId },
      });
      if (changed.count !== 1) {
        return null;
      }
      const updated = await transaction.moderationAppeal.findUnique({
        where: { id: appeal.id },
      });
      if (!updated) {
        throw new Error('The appeal was not persisted.');
      }
      if (input.status === 'REJECTED') {
        await transaction.moderationCase.updateMany({
          where: {
            id: appeal.caseId,
            guildId: input.guildId,
            status: 'APPEALED',
          },
          data: { status: 'COMPLETED' },
        });
      }
      await writeAudit(transaction, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: 'MODERATION_APPEAL_REVIEWED',
        subjectType: 'moderation_appeal',
        subjectId: appeal.id,
        details: { status: input.status },
      });
      await transaction.notification.create({
        data: {
          guildId: input.guildId,
          userId: appeal.appellantId,
          type: 'moderation.appeal_reviewed',
          message: `Votre contestation a été examinée : ${input.status.toLowerCase()}.`,
        },
      });
      return updated;
    });
  }

  listAudit(guildId: string, limit: number): Promise<unknown[]> {
    return this.prisma.auditEvent.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  listNotifications(guildId: string, userId: string): Promise<unknown[]> {
    return this.prisma.notification.findMany({
      where: { guildId, userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markNotificationRead(
    guildId: string,
    userId: string,
    notificationId: string,
  ): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, guildId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count > 0;
  }

  async claimModerationActions(): Promise<
    Array<{
      id: string;
      guildId: string;
      caseId: string;
      status: ModerationJobStatus;
      case: {
        targetDiscordId: string;
        actorUserId: string;
        actorDiscordId: string;
        action: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN';
        reason: string;
        durationSeconds: number | null;
      };
    }>
  > {
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const queued = await this.prisma.moderationAction.findMany({
      where: {
        OR: [
          { status: ModerationJobStatus.QUEUED },
          {
            status: ModerationJobStatus.PROCESSING,
            updatedAt: { lt: staleBefore },
          },
        ],
      },
      include: { case: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const claimed = [];
    for (const action of queued) {
      const result = await this.prisma.moderationAction.updateMany({
        where: {
          id: action.id,
          OR: [
            { status: ModerationJobStatus.QUEUED },
            {
              status: ModerationJobStatus.PROCESSING,
              updatedAt: { lt: staleBefore },
            },
          ],
        },
        data: { status: ModerationJobStatus.PROCESSING },
      });
      if (result.count === 1) {
        claimed.push({ ...action, status: ModerationJobStatus.PROCESSING });
      }
    }
    return claimed;
  }

  async completeModerationAction(input: {
    id: string;
    success: boolean;
    message: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const action = await transaction.moderationAction.findFirst({
        where: { id: input.id },
        include: { case: true },
      });
      if (!action) {
        return false;
      }
      const completedStatus = input.success
        ? ModerationJobStatus.SUCCEEDED
        : ModerationJobStatus.FAILED;
      if (action.status === completedStatus) {
        return true;
      }
      if (action.status !== ModerationJobStatus.PROCESSING) {
        return false;
      }
      await transaction.moderationAction.update({
        where: { id: input.id },
        data: { status: completedStatus },
      });
      await transaction.moderationCase.update({
        where: { id: action.caseId },
        data: {
          status: input.success ? 'COMPLETED' : 'FAILED',
          resultMessage: input.message,
        },
      });
      await writeAudit(transaction, {
        guildId: action.guildId,
        actorUserId: action.case.actorUserId,
        action: input.success
          ? 'MODERATION_ACTION_COMPLETED'
          : 'MODERATION_ACTION_FAILED',
        subjectType: 'moderation_case',
        subjectId: action.caseId,
        details: { message: input.message },
      });
      await transaction.notification.create({
        data: {
          guildId: action.guildId,
          userId: action.case.actorUserId,
          type: input.success
            ? 'moderation.action_completed'
            : 'moderation.action_failed',
          message: input.success
            ? 'Votre action de modération a été exécutée.'
            : 'Votre action de modération a échoué.',
        },
      });
      return true;
    });
  }
}

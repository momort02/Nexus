import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ApiError } from '../../http/api-error.js';
import { createBotRequestAuthentication } from '../../http/bot-signature.js';
import type { Environment } from '../../config/env.js';
import { decryptAccessToken } from '../auth/crypto.js';
import type { AuthRepository, DiscordClient } from '../auth/types.js';
import {
  createRequireGuildAccess,
  createRequireSameOrigin,
  createRequireSession,
} from '../auth/session.js';
import type { AuthorizationService } from '../permissions/authorization.service.js';
import { requirePermission } from '../permissions/permission.middleware.js';
import type { PermissionKey } from '../permissions/catalog.js';
import type { StaffModerationRepository } from './types.js';
import type { BotIngestionRepository } from '../bot-ingestion/types.js';

const discordId = z.string().regex(/^\d{17,20}$/);
const recordId = z.string().min(1).max(128);
const taskStatus = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'VALIDATED']);
const itemStatus = z.enum([
  'OPEN',
  'UNDER_REVIEW',
  'ACCEPTED',
  'REJECTED',
  'CLOSED',
]);
const appealStatus = z.enum(['ACCEPTED', 'REJECTED']);
const actionSchema = z.enum(['WARN', 'TIMEOUT', 'KICK', 'BAN']);

function parse<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  code: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, code, 'The request data is invalid.');
  }
  return parsed.data;
}

function guildId(value: string | string[] | undefined): string {
  return parse(discordId, value, 'invalid_guild_id');
}

function idParam(value: string | string[] | undefined): string {
  return parse(recordId, value, 'invalid_resource_id');
}

const actionPermission = {
  WARN: { permission: 'moderation.warn', discordBit: 0n },
  TIMEOUT: {
    permission: 'moderation.timeout',
    discordBit: 1n << 40n,
  },
  KICK: { permission: 'moderation.kick', discordBit: 1n << 1n },
  BAN: { permission: 'moderation.ban', discordBit: 1n << 2n },
} as const;

async function assertDiscordActionAllowed(
  input: {
    userId: string;
    guildId: string;
    permission: (typeof actionPermission)[keyof typeof actionPermission]['permission'];
    discordBit: bigint;
    encryptedAccessToken: string | null;
    accessTokenExpiresAt: Date | null;
  },
  dependencies: {
    authorization: AuthorizationService;
    discord: DiscordClient;
    encryptionKey: string;
  },
): Promise<void> {
  await dependencies.authorization.assertPermission(
    input.userId,
    input.guildId,
    input.permission,
  );
  if (
    !input.encryptedAccessToken ||
    !input.accessTokenExpiresAt ||
    input.accessTokenExpiresAt <= new Date()
  ) {
    throw new ApiError(
      401,
      'discord_reauth_required',
      'Reconnectez-vous à Discord avant de lancer cette action.',
    );
  }
  const token = decryptAccessToken(
    input.encryptedAccessToken,
    dependencies.encryptionKey,
  );
  const guilds = await dependencies.discord.getGuilds(token);
  const guild = guilds.find((entry) => entry.id === input.guildId);
  if (
    !guild ||
    (BigInt(guild.permissions) & input.discordBit) !== input.discordBit
  ) {
    throw new ApiError(
      403,
      'discord_permission_denied',
      'La permission Discord requise est manquante.',
    );
  }
}

export function createStaffModerationRouter(dependencies: {
  authRepository: AuthRepository;
  authorization: AuthorizationService;
  repository: StaffModerationRepository;
  discord: DiscordClient;
  environment: Environment;
}): Router {
  const router = Router();
  const requireSession = createRequireSession(dependencies.authRepository);
  const requireGuildAccess = createRequireGuildAccess(
    dependencies.authRepository,
  );
  const requireSameOrigin = createRequireSameOrigin(
    dependencies.environment.APP_ORIGIN,
  );
  const limit = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.use('/guilds/:guildId', requireSession, requireGuildAccess);
  router.use('/guilds/:guildId', limit);

  router.get(
    '/guilds/:guildId/members',
    requirePermission(dependencies.authorization, 'members.view'),
    async (request, response) => {
      const input = parse(
        z.object({
          page: z.coerce.number().int().min(1).max(10_000).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
          search: z.string().trim().max(64).optional(),
          roleId: discordId.optional(),
        }),
        request.query,
        'invalid_members_filter',
      );
      const result = await dependencies.repository.listMembers({
        guildId: guildId(request.params.guildId),
        page: input.page,
        pageSize: input.pageSize,
        ...(input.search ? { search: input.search } : {}),
        ...(input.roleId ? { roleId: input.roleId } : {}),
      });
      response.json({
        ...result,
        page: input.page,
        pageSize: input.pageSize,
        pages: Math.ceil(result.total / input.pageSize),
      });
    },
  );

  router.get(
    '/guilds/:guildId/staff',
    requirePermission(dependencies.authorization, 'staff.view'),
    async (request, response) => {
      response.json({
        profiles: await dependencies.repository.listStaff(
          guildId(request.params.guildId),
        ),
      });
    },
  );
  router.put(
    '/guilds/:guildId/staff/:userId',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'staff.manage'),
    async (request, response) => {
      const input = parse(
        z.object({
          title: z.string().trim().min(1).max(80).nullable(),
          active: z.boolean(),
        }),
        request.body,
        'invalid_staff_profile',
      );
      const profile = await dependencies.repository.upsertStaff({
        guildId: guildId(request.params.guildId),
        userId: idParam(request.params.userId),
        ...input,
        actorUserId: response.locals.authSession.userId,
      });
      if (!profile) {
        throw new ApiError(
          404,
          'guild_member_not_found',
          'Le membre n’appartient pas à ce serveur Nexus.',
        );
      }
      response.json({ profile });
    },
  );
  router.get(
    '/guilds/:guildId/staff/teams',
    requirePermission(dependencies.authorization, 'staff.view'),
    async (request, response) => {
      response.json({
        teams: await dependencies.repository.listTeams(
          guildId(request.params.guildId),
        ),
      });
    },
  );
  router.post(
    '/guilds/:guildId/staff/teams',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'staff.manage'),
    async (request, response) => {
      const input = parse(
        z.object({
          name: z.string().trim().min(1).max(80),
          description: z.string().trim().max(500).nullable().default(null),
        }),
        request.body,
        'invalid_staff_team',
      );
      const team = await dependencies.repository.createTeam({
        ...input,
        guildId: guildId(request.params.guildId),
        actorUserId: response.locals.authSession.userId,
      });
      response.status(201).json({ team });
    },
  );
  router.post(
    '/guilds/:guildId/staff/teams/:teamId/members',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'staff.assign'),
    async (request, response) => {
      const input = parse(
        z.object({ userId: recordId }),
        request.body,
        'invalid_team_member',
      );
      const added = await dependencies.repository.addTeamMember({
        guildId: guildId(request.params.guildId),
        teamId: idParam(request.params.teamId),
        userId: input.userId,
        actorUserId: response.locals.authSession.userId,
      });
      if (!added) {
        throw new ApiError(
          404,
          'staff_member_not_found',
          'L’équipe ou le profil staff actif est introuvable.',
        );
      }
      response.status(204).end();
    },
  );

  router.get(
    '/guilds/:guildId/tasks',
    requirePermission(dependencies.authorization, 'tasks.view'),
    async (request, response) => {
      response.json({
        tasks: await dependencies.repository.listTasks(
          guildId(request.params.guildId),
        ),
      });
    },
  );
  router.post(
    '/guilds/:guildId/tasks',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'tasks.create'),
    async (request, response) => {
      const input = parse(
        z.object({
          title: z.string().trim().min(1).max(160),
          description: z.string().trim().min(1).max(5000),
          assigneeId: recordId.nullable().default(null),
          dueAt: z.string().datetime({ offset: true }).nullable().default(null),
        }),
        request.body,
        'invalid_task',
      );
      if (input.assigneeId) {
        await dependencies.authorization.assertPermission(
          response.locals.authSession.userId,
          guildId(request.params.guildId),
          'tasks.assign',
        );
      }
      const task = await dependencies.repository.createTask({
        ...input,
        guildId: guildId(request.params.guildId),
        actorUserId: response.locals.authSession.userId,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      });
      if (!task) {
        throw new ApiError(
          400,
          'invalid_task_assignee',
          'Le responsable doit être un profil staff actif du serveur.',
        );
      }
      response.status(201).json({ task });
    },
  );
  router.patch(
    '/guilds/:guildId/tasks/:taskId',
    requireSameOrigin,
    async (request, response, next) => {
      try {
        const input = parse(
          z
            .object({
              status: taskStatus.optional(),
              comment: z.string().trim().min(1).max(2000).optional(),
            })
            .refine((value) => value.status !== undefined || value.comment),
          request.body,
          'invalid_task_update',
        );
        const permission =
          input.status === 'VALIDATED'
            ? 'tasks.validate'
            : input.status === 'COMPLETED'
              ? 'tasks.complete'
              : 'tasks.update';
        await dependencies.authorization.assertPermission(
          response.locals.authSession.userId,
          guildId(request.params.guildId),
          permission,
        );
        const task = await dependencies.repository.updateTask({
          guildId: guildId(request.params.guildId),
          taskId: idParam(request.params.taskId),
          actorUserId: response.locals.authSession.userId,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
        });
        if (!task) {
          throw new ApiError(
            404,
            'task_not_found',
            'La tâche est introuvable.',
          );
        }
        response.json({ task });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/guilds/:guildId/reports',
    requireSameOrigin,
    async (request, response) => {
      const input = parse(
        z.object({
          targetDiscordId: discordId,
          category: z.string().trim().min(1).max(80),
          details: z.string().trim().min(1).max(5000),
        }),
        request.body,
        'invalid_report',
      );
      const report = await dependencies.repository.createReport({
        ...input,
        guildId: guildId(request.params.guildId),
        reporterId: response.locals.authSession.userId,
      });
      response.status(201).json({ report });
    },
  );
  router.get(
    '/guilds/:guildId/reports',
    requirePermission(dependencies.authorization, 'reports.view'),
    async (request, response) => {
      response.json({
        reports: await dependencies.repository.listReports(
          guildId(request.params.guildId),
        ),
      });
    },
  );
  router.patch(
    '/guilds/:guildId/reports/:reportId',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'reports.manage'),
    async (request, response) => {
      const input = parse(
        z.object({
          status: itemStatus,
          assignedTo: recordId.nullable().default(null),
        }),
        request.body,
        'invalid_report_update',
      );
      const report = await dependencies.repository.updateReport({
        ...input,
        guildId: guildId(request.params.guildId),
        reportId: idParam(request.params.reportId),
        actorUserId: response.locals.authSession.userId,
      });
      if (!report) {
        throw new ApiError(
          404,
          'report_or_staff_not_found',
          'Le signalement ou le profil staff est introuvable.',
        );
      }
      response.json({ report });
    },
  );

  router.post(
    '/guilds/:guildId/applications',
    requireSameOrigin,
    async (request, response) => {
      const input = parse(
        z.object({
          answers: z
            .record(z.string().trim().min(1).max(2000))
            .refine(
              (answers) =>
                Object.keys(answers).length >= 1 &&
                Object.keys(answers).length <= 20,
            ),
        }),
        request.body,
        'invalid_application',
      );
      const application = await dependencies.repository.createApplication({
        ...input,
        guildId: guildId(request.params.guildId),
        applicantId: response.locals.authSession.userId,
        applicantDiscordId: response.locals.authSession.user.discordId,
      });
      response.status(201).json({ application });
    },
  );
  router.get(
    '/guilds/:guildId/applications',
    requirePermission(dependencies.authorization, 'applications.view'),
    async (request, response) => {
      response.json({
        applications: await dependencies.repository.listApplications(
          guildId(request.params.guildId),
        ),
      });
    },
  );
  router.patch(
    '/guilds/:guildId/applications/:applicationId',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'applications.review'),
    async (request, response) => {
      const input = parse(
        z.object({ status: itemStatus }),
        request.body,
        'invalid_application_update',
      );
      const application = await dependencies.repository.updateApplication({
        ...input,
        guildId: guildId(request.params.guildId),
        applicationId: idParam(request.params.applicationId),
        actorUserId: response.locals.authSession.userId,
      });
      if (!application) {
        throw new ApiError(
          404,
          'application_not_found',
          'La candidature est introuvable.',
        );
      }
      response.json({ application });
    },
  );

  router.get(
    '/guilds/:guildId/moderation/cases',
    requirePermission(dependencies.authorization, 'moderation.view'),
    async (request, response) => {
      response.json({
        cases: await dependencies.repository.listCases(
          guildId(request.params.guildId),
        ),
      });
    },
  );
  router.post(
    '/guilds/:guildId/moderation/cases',
    requireSameOrigin,
    async (request, response) => {
      const input = parse(
        z
          .object({
            targetDiscordId: discordId,
            action: actionSchema,
            reason: z.string().trim().min(1).max(1000),
            durationSeconds: z
              .number()
              .int()
              .min(1)
              .max(2_419_200)
              .nullable()
              .default(null),
          })
          .superRefine((value, context) => {
            if (value.action === 'TIMEOUT' && value.durationSeconds === null) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'A timeout duration is required.',
              });
            }
            if (value.action !== 'TIMEOUT' && value.durationSeconds !== null) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'A duration is only valid for a timeout.',
              });
            }
          }),
        request.body,
        'invalid_moderation_action',
      );
      const session = response.locals.authSession;
      const permission = actionPermission[input.action];
      await assertDiscordActionAllowed(
        {
          userId: session.userId,
          guildId: guildId(request.params.guildId),
          permission: permission.permission,
          discordBit: permission.discordBit,
          encryptedAccessToken: session.encryptedAccessToken,
          accessTokenExpiresAt: session.accessTokenExpiresAt,
        },
        {
          authorization: dependencies.authorization,
          discord: dependencies.discord,
          encryptionKey: dependencies.environment.OAUTH_ENCRYPTION_KEY,
        },
      );
      const moderationCase = await dependencies.repository.createModerationCase(
        {
          ...input,
          guildId: guildId(request.params.guildId),
          actorUserId: session.userId,
          actorDiscordId: session.user.discordId,
        },
      );
      response.status(202).json({ case: moderationCase });
    },
  );
  router.post(
    '/guilds/:guildId/moderation/cases/:caseId/appeals',
    requireSameOrigin,
    async (request, response) => {
      const input = parse(
        z.object({ message: z.string().trim().min(1).max(3000) }),
        request.body,
        'invalid_appeal',
      );
      const appeal = await dependencies.repository.createAppeal({
        ...input,
        guildId: guildId(request.params.guildId),
        caseId: idParam(request.params.caseId),
        appellantId: response.locals.authSession.userId,
        appellantDiscordId: response.locals.authSession.user.discordId,
      });
      if (!appeal) {
        throw new ApiError(
          404,
          'appealable_case_not_found',
          'Aucun dossier terminé ne vous permet de déposer cette contestation.',
        );
      }
      response.status(201).json({ appeal });
    },
  );
  router.get(
    '/guilds/:guildId/moderation/appeals',
    requirePermission(dependencies.authorization, 'moderation.appeals.view'),
    async (request, response) => {
      response.json({
        appeals: await dependencies.repository.listAppeals(
          guildId(request.params.guildId),
        ),
      });
    },
  );
  router.patch(
    '/guilds/:guildId/moderation/appeals/:appealId',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'moderation.appeals.manage'),
    async (request, response) => {
      const input = parse(
        z.object({ status: appealStatus }),
        request.body,
        'invalid_appeal_update',
      );
      const appeal = await dependencies.repository.updateAppeal({
        ...input,
        guildId: guildId(request.params.guildId),
        appealId: idParam(request.params.appealId),
        actorUserId: response.locals.authSession.userId,
      });
      if (!appeal) {
        throw new ApiError(
          404,
          'appeal_not_found',
          'La contestation est introuvable.',
        );
      }
      response.json({ appeal });
    },
  );

  router.get(
    '/guilds/:guildId/audit',
    requirePermission(dependencies.authorization, 'audit.view'),
    async (request, response) => {
      const limit = parse(
        z.coerce.number().int().min(1).max(100).default(50),
        request.query.limit,
        'invalid_audit_limit',
      );
      response.json({
        events: await dependencies.repository.listAudit(
          guildId(request.params.guildId),
          limit,
        ),
      });
    },
  );
  router.get('/guilds/:guildId/notifications', async (_request, response) => {
    response.json({
      notifications: await dependencies.repository.listNotifications(
        guildId(_request.params.guildId),
        response.locals.authSession.userId,
      ),
    });
  });
  router.post(
    '/guilds/:guildId/notifications/:notificationId/read',
    requireSameOrigin,
    async (request, response) => {
      const updated = await dependencies.repository.markNotificationRead(
        guildId(request.params.guildId),
        response.locals.authSession.userId,
        idParam(request.params.notificationId),
      );
      if (!updated) {
        throw new ApiError(
          404,
          'notification_not_found',
          'La notification est introuvable.',
        );
      }
      response.status(204).end();
    },
  );

  return router;
}

export function createModerationWorkerRouter(dependencies: {
  repository: StaffModerationRepository;
  nonceRepository: Pick<BotIngestionRepository, 'consumeRequestNonce'>;
  authorization: AuthorizationService;
  secret: string;
}): Router {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  router.use(
    createBotRequestAuthentication({
      secret: dependencies.secret,
      consumeNonce: (nonce, expiresAt) =>
        dependencies.nonceRepository.consumeRequestNonce(nonce, expiresAt),
    }),
  );
  router.post('/claim', async (_request, response) => {
    const queued = await dependencies.repository.claimModerationActions();
    const permissionByAction: Record<
      z.infer<typeof actionSchema>,
      PermissionKey
    > = {
      WARN: 'moderation.warn',
      TIMEOUT: 'moderation.timeout',
      KICK: 'moderation.kick',
      BAN: 'moderation.ban',
    };
    const actions = [];
    for (const action of queued) {
      const permission = permissionByAction[action.case.action];
      if (
        await dependencies.authorization.hasPermission(
          action.case.actorUserId,
          action.guildId,
          permission,
        )
      ) {
        actions.push(action);
      } else {
        await dependencies.repository.completeModerationAction({
          id: action.id,
          success: false,
          message: 'La permission Nexus a été révoquée avant exécution.',
        });
      }
    }
    response.json({ actions });
  });
  router.post('/:actionId/result', async (request, response) => {
    const result = parse(
      z.object({
        success: z.boolean(),
        message: z.string().trim().min(1).max(500),
      }),
      request.body,
      'invalid_moderation_result',
    );
    const updated = await dependencies.repository.completeModerationAction({
      id: idParam(request.params.actionId),
      ...result,
    });
    if (!updated) {
      throw new ApiError(
        404,
        'moderation_action_not_found',
        'The queued action is no longer available.',
      );
    }
    response.status(204).end();
  });
  return router;
}

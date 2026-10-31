import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { Environment } from './config/env.js';
import { ApiError } from './http/api-error.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import {
  createRequireGuildAccess,
  createRequireSession,
} from './modules/auth/session.js';
import type { AuthRepository, DiscordClient } from './modules/auth/types.js';
import { AuthorizationService } from './modules/permissions/authorization.service.js';
import { requirePermission } from './modules/permissions/permission.middleware.js';
import { createPermissionsRouter } from './modules/permissions/permissions.routes.js';
import type { RbacRepository } from './modules/permissions/types.js';
import { createBotIngestionRouter } from './modules/bot-ingestion/bot-ingestion.routes.js';
import type { BotIngestionRepository } from './modules/bot-ingestion/types.js';
import { createAnalyticsRouter } from './modules/analytics/analytics.routes.js';
import type { AnalyticsRepository } from './modules/analytics/types.js';
import {
  createModerationWorkerRouter,
  createStaffModerationRouter,
} from './modules/staff-moderation/staff-moderation.routes.js';
import type { StaffModerationRepository } from './modules/staff-moderation/types.js';

interface AppDependencies {
  repository: AuthRepository;
  rbacRepository: RbacRepository;
  botIngestionRepository: BotIngestionRepository;
  botApiSecret: string;
  analyticsRepository: AnalyticsRepository;
  staffModerationRepository: StaffModerationRepository;
  discord: DiscordClient;
  environment: Environment;
  publishGuildEvent?: (guildId: string) => void | Promise<void>;
}

export function createApp({
  repository,
  rbacRepository,
  botIngestionRepository,
  botApiSecret,
  analyticsRepository,
  staffModerationRepository,
  discord,
  environment,
  publishGuildEvent,
}: AppDependencies): Express {
  const app = express();

  const requestIdMiddleware: RequestHandler = (_request, response, next) => {
    response.locals.requestId = randomUUID();
    next();
  };
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(
    cors({
      origin: environment.APP_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    }),
  );
  app.use(
    '/api/internal/v1/discord/events',
    express.json({
      limit: '1mb',
      verify: (request, _response, buffer) => {
        request.rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(
    '/api/internal/v1/moderation/actions',
    express.json({
      limit: '8kb',
      verify: (request, _response, buffer) => {
        request.rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  const apiRouter = express.Router();
  apiRouter.use((request, response, next) => {
    response.on('finish', () => {
      const match = request.path.match(/^\/guilds\/(\d{17,20})(?:\/|$)/);
      if (
        match?.[1] &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
        response.statusCode < 400
      ) {
        void Promise.resolve(publishGuildEvent?.(match[1])).catch(
          (error: unknown) => {
            console.error('Realtime event delivery failed.', {
              requestId: response.locals.requestId,
              errorName: error instanceof Error ? error.name : 'UnknownError',
            });
          },
        );
      }
    });
    next();
  });
  const authorization = new AuthorizationService(rbacRepository);
  apiRouter.use(createAuthRouter({ repository, discord, environment }));
  apiRouter.use(
    createPermissionsRouter({
      authRepository: repository,
      authorization,
      appOrigin: environment.APP_ORIGIN,
    }),
  );
  apiRouter.use(
    createAnalyticsRouter({
      authRepository: repository,
      authorization,
      repository: analyticsRepository,
      appOrigin: environment.APP_ORIGIN,
    }),
  );
  apiRouter.use(
    createStaffModerationRouter({
      authRepository: repository,
      authorization,
      repository: staffModerationRepository,
      discord,
      environment,
    }),
  );
  apiRouter.get(
    '/guilds/:guildId',
    createRequireSession(repository),
    createRequireGuildAccess(repository),
    requirePermission(authorization, 'dashboard.view'),
    (_request, response) => {
      const membership = response.locals.guildMembership;
      response.json({ guild: membership });
    },
  );
  app.use('/api/v1', apiRouter);
  app.use(
    '/api/internal/v1/discord/events',
    createBotIngestionRouter({
      repository: botIngestionRepository,
      secret: botApiSecret,
      ...(publishGuildEvent ? { publishGuildEvent } : {}),
    }),
  );
  app.use(
    '/api/internal/v1/moderation/actions',
    createModerationWorkerRouter({
      repository: staffModerationRepository,
      nonceRepository: botIngestionRepository,
      authorization,
      secret: botApiSecret,
    }),
  );

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: 'not_found',
        message: 'The requested resource was not found.',
        requestId: response.locals.requestId,
      },
    });
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    void next;
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(500, 'internal_error', 'An unexpected error occurred.');

    if (apiError.status >= 500) {
      console.error('API request failed.', {
        requestId: response.locals.requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        ...(error instanceof ZodError
          ? {
              validationIssues: error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path.map(String).join('.'),
              })),
            }
          : {}),
      });
    }

    response.status(apiError.status).json({
      error: {
        code: apiError.code,
        message: apiError.message,
        requestId: response.locals.requestId,
      },
    });
  };
  app.use(errorHandler);

  return app;
}

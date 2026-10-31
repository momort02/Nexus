import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../http/api-error.js';
import type { AuthRepository } from '../auth/types.js';
import {
  createRequireGuildAccess,
  createRequireSession,
  createRequireSameOrigin,
} from '../auth/session.js';
import { PERMISSIONS, PERMISSION_DESCRIPTIONS } from './catalog.js';
import type { AuthorizationService } from './authorization.service.js';
import { requirePermission } from './permission.middleware.js';

const permissionEffectsSchema = z.record(
  z.enum(PERMISSIONS),
  z.enum(['ALLOW', 'DENY']),
);
const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  permissions: permissionEffectsSchema.default({}),
});
const updateRolePermissionsSchema = z.object({
  permissions: permissionEffectsSchema,
});
const assignRoleSchema = z.object({
  userId: z.string().min(1).max(128),
  roleId: z.string().min(1).max(128),
});

function getGuildId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !/^\d{17,20}$/.test(value)) {
    throw new ApiError(
      400,
      'invalid_guild_id',
      'The server identifier is invalid.',
    );
  }
  return value;
}

function slugifyRoleName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 33);
  return `CUSTOM_${slug}`;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, 'invalid_request', 'The request body is invalid.');
  }
  return result.data;
}

export function createPermissionsRouter(dependencies: {
  authRepository: AuthRepository;
  authorization: AuthorizationService;
  appOrigin: string;
}): Router {
  const router = Router();
  const requireSession = createRequireSession(dependencies.authRepository);
  const requireGuildAccess = createRequireGuildAccess(
    dependencies.authRepository,
  );
  const requireSameOrigin = createRequireSameOrigin(dependencies.appOrigin);

  router.use('/guilds/:guildId', requireSession, requireGuildAccess);

  router.get(
    '/guilds/:guildId/permission-catalog',
    requirePermission(dependencies.authorization, 'permissions.view'),
    (_request, response) => {
      response.json({
        permissions: PERMISSIONS.map((key) => ({
          key,
          description: PERMISSION_DESCRIPTIONS[key],
        })),
      });
    },
  );

  router.get(
    '/guilds/:guildId/roles',
    requirePermission(dependencies.authorization, 'permissions.view'),
    async (request, response) => {
      const guildId = getGuildId(request.params.guildId);
      const roles = await dependencies.authorization.listRoles(
        response.locals.authSession.userId,
        guildId,
      );
      response.json({ roles });
    },
  );

  router.post(
    '/guilds/:guildId/roles',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'permissions.manage'),
    async (request, response) => {
      const body = parseBody(createRoleSchema, request.body);
      const role = await dependencies.authorization.createRole(
        response.locals.authSession.userId,
        getGuildId(request.params.guildId),
        {
          key: slugifyRoleName(body.name),
          name: body.name,
          permissions: body.permissions ?? {},
        },
      );
      response.status(201).json({ role });
    },
  );

  router.put(
    '/guilds/:guildId/roles/:roleId/permissions',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'permissions.manage'),
    async (request, response) => {
      const body = parseBody(updateRolePermissionsSchema, request.body);
      const roleId = request.params.roleId;
      if (typeof roleId !== 'string') {
        throw new ApiError(
          400,
          'invalid_role_id',
          'The role identifier is invalid.',
        );
      }

      const role = await dependencies.authorization.updateRolePermissions(
        response.locals.authSession.userId,
        getGuildId(request.params.guildId),
        roleId,
        body.permissions,
      );
      response.json({ role });
    },
  );

  router.post(
    '/guilds/:guildId/role-assignments',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'permissions.manage'),
    async (request, response) => {
      const body = parseBody(assignRoleSchema, request.body);
      await dependencies.authorization.assignRole(
        response.locals.authSession.userId,
        getGuildId(request.params.guildId),
        body.userId,
        body.roleId,
      );
      response.status(204).end();
    },
  );

  return router;
}

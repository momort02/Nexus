import type { RequestHandler } from 'express';
import type { PermissionKey } from './catalog.js';
import type { AuthorizationService } from './authorization.service.js';

export function requirePermission(
  authorization: AuthorizationService,
  permission: PermissionKey,
): RequestHandler {
  return async (_request, response, next) => {
    const session = response.locals.authSession;
    const membership = response.locals.guildMembership;

    if (!session || !membership) {
      response.status(403).json({
        error: {
          code: 'guild_access_denied',
          message: 'You do not have access to this server.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }

    if (
      !(await authorization.hasPermission(
        session.userId,
        membership.id,
        permission,
      ))
    ) {
      response.status(403).json({
        error: {
          code: 'permission_denied',
          message: 'You do not have permission to perform this action.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }

    next();
  };
}

export function requireDiscordPermission(
  authorization: AuthorizationService,
  permission: PermissionKey,
  requiredDiscordPermissions: bigint,
  resolveDiscordPermissions: (
    userId: string,
    guildId: string,
  ) => Promise<bigint | null>,
): RequestHandler {
  return async (_request, response, next) => {
    const session = response.locals.authSession;
    const membership = response.locals.guildMembership;

    if (!session || !membership) {
      response.status(403).json({
        error: {
          code: 'guild_access_denied',
          message: 'You do not have access to this server.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }

    try {
      await authorization.assertDiscordPermission(
        session.userId,
        membership.id,
        permission,
        requiredDiscordPermissions,
        resolveDiscordPermissions,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

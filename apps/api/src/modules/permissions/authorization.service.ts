import { ApiError } from '../../http/api-error.js';
import {
  DEFAULT_ROLES,
  isPermissionKey,
  type PermissionEffect,
  type PermissionKey,
} from './catalog.js';
import type {
  AuthorizationContext,
  GuildRoleRecord,
  RbacRepository,
} from './types.js';

export class AuthorizationService {
  constructor(private readonly repository: RbacRepository) {}

  async hasPermission(
    userId: string,
    guildId: string,
    permission: string,
  ): Promise<boolean> {
    if (!isPermissionKey(permission)) {
      return false;
    }

    const context = await this.repository.getAuthorizationContext(
      userId,
      guildId,
    );
    return this.contextHasPermission(context, permission);
  }

  async assertPermission(
    userId: string,
    guildId: string,
    permission: PermissionKey,
  ): Promise<AuthorizationContext> {
    const context = await this.repository.getAuthorizationContext(
      userId,
      guildId,
    );
    if (!context || !this.contextHasPermission(context, permission)) {
      throw new ApiError(
        403,
        'permission_denied',
        'You do not have permission to perform this action.',
      );
    }
    return context;
  }

  async assertDiscordPermission(
    userId: string,
    guildId: string,
    permission: PermissionKey,
    requiredDiscordPermissions: bigint,
    resolveDiscordPermissions: (
      userId: string,
      guildId: string,
    ) => Promise<bigint | null>,
  ): Promise<void> {
    await this.assertPermission(userId, guildId, permission);
    const actualPermissions = await resolveDiscordPermissions(userId, guildId);

    if (
      actualPermissions === null ||
      (actualPermissions & requiredDiscordPermissions) !==
        requiredDiscordPermissions
    ) {
      throw new ApiError(
        403,
        'discord_permission_denied',
        'The required Discord permissions are missing.',
      );
    }
  }

  async listRoles(userId: string, guildId: string): Promise<GuildRoleRecord[]> {
    await this.assertPermission(userId, guildId, 'permissions.view');
    return this.repository.listRoles(guildId);
  }

  async createRole(
    actorUserId: string,
    guildId: string,
    input: {
      key: string;
      name: string;
      permissions: Partial<Record<PermissionKey, PermissionEffect>>;
    },
  ): Promise<GuildRoleRecord> {
    const context = await this.assertPermission(
      actorUserId,
      guildId,
      'permissions.manage',
    );
    this.assertCanGrant(context, input.permissions);

    const key = input.key.trim().toUpperCase();
    if (
      !key ||
      DEFAULT_ROLES.some((role) => role.key === key) ||
      !/^[A-Z][A-Z0-9_]{1,39}$/.test(key)
    ) {
      throw new ApiError(400, 'invalid_role_key', 'The role key is invalid.');
    }

    const role = await this.repository.createCustomRole({
      guildId,
      actorUserId,
      ...input,
      key,
    });
    return role;
  }

  async updateRolePermissions(
    actorUserId: string,
    guildId: string,
    roleId: string,
    permissions: Partial<Record<PermissionKey, PermissionEffect>>,
  ): Promise<GuildRoleRecord> {
    const context = await this.assertPermission(
      actorUserId,
      guildId,
      'permissions.manage',
    );
    this.assertCanGrant(context, permissions);
    const existingRole = (await this.repository.listRoles(guildId)).find(
      (role) => role.id === roleId,
    );
    if (!existingRole) {
      throw new ApiError(404, 'role_not_found', 'The role was not found.');
    }
    if (existingRole.isSystem) {
      throw new ApiError(
        403,
        'system_role_protected',
        'Default roles cannot be modified.',
      );
    }

    const role = await this.repository.updateCustomRolePermissions({
      guildId,
      actorUserId,
      roleId,
      permissions,
    });

    if (!role) {
      throw new ApiError(404, 'role_not_found', 'The role was not found.');
    }

    return role;
  }

  async assignRole(
    actorUserId: string,
    guildId: string,
    targetUserId: string,
    roleId: string,
  ): Promise<void> {
    if (actorUserId === targetUserId) {
      throw new ApiError(
        403,
        'self_role_assignment_denied',
        'You cannot assign roles to yourself.',
      );
    }

    const context = await this.assertPermission(
      actorUserId,
      guildId,
      'permissions.manage',
    );
    const actorRank = Math.max(...context.roles.map((role) => role.rank));
    const role = (await this.repository.listRoles(guildId)).find(
      (candidate) => candidate.id === roleId,
    );

    if (!role) {
      throw new ApiError(404, 'role_not_found', 'The role was not found.');
    }

    if (role.rank >= actorRank) {
      throw new ApiError(
        403,
        'role_hierarchy_denied',
        'You cannot assign a role at or above your highest role.',
      );
    }

    this.assertCanGrant(
      context,
      Object.fromEntries(
        role.permissions.map(({ key, effect }) => [key, effect]),
      ) as Partial<Record<PermissionKey, PermissionEffect>>,
    );

    const result = await this.repository.assignRole({
      guildId,
      actorUserId,
      targetUserId,
      roleId,
    });
    if (result === 'not-found') {
      throw new ApiError(
        404,
        'guild_member_or_role_not_found',
        'The guild member or role was not found.',
      );
    }
    if (result === 'already-assigned') {
      throw new ApiError(
        409,
        'role_already_assigned',
        'The member already has this role.',
      );
    }
  }

  private contextHasPermission(
    context: AuthorizationContext | null,
    permission: PermissionKey,
  ): boolean {
    if (!context || context.roles.length === 0) {
      return false;
    }

    if (context.roles.some((role) => role.key === 'OWNER')) {
      return true;
    }

    const effects = context.roles.flatMap((role) =>
      role.permissions
        .filter((entry) => entry.key === permission)
        .map((entry) => entry.effect),
    );

    if (effects.includes('DENY')) {
      return false;
    }
    return effects.includes('ALLOW');
  }

  private assertCanGrant(
    context: AuthorizationContext,
    permissions: Partial<Record<PermissionKey, PermissionEffect>>,
  ): void {
    for (const [key, effect] of Object.entries(permissions)) {
      if (!isPermissionKey(key) || !effect) {
        throw new ApiError(
          400,
          'invalid_permission',
          'The permission configuration is invalid.',
        );
      }

      if (key === 'server.delete' && effect === 'ALLOW') {
        throw new ApiError(
          403,
          'protected_permission',
          'This permission can only be held by the system Owner role.',
        );
      }

      if (effect === 'ALLOW' && !this.contextHasPermission(context, key)) {
        throw new ApiError(
          403,
          'permission_escalation_denied',
          'You cannot grant a permission you do not have.',
        );
      }
    }
  }
}

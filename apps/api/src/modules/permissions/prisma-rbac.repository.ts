import { Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_ROLES,
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  type PermissionEffect,
  type PermissionKey,
} from './catalog.js';
import type {
  AuthorizationContext,
  GuildRoleRecord,
  RbacRepository,
} from './types.js';
import { ApiError } from '../../http/api-error.js';

const roleInclude = {
  permissions: {
    include: { permission: true },
  },
} satisfies Prisma.GuildRoleInclude;

function mapRole(
  role: Prisma.GuildRoleGetPayload<{ include: typeof roleInclude }>,
): GuildRoleRecord {
  return {
    id: role.id,
    guildId: role.guildId,
    key: role.key,
    name: role.name,
    rank: role.rank,
    isSystem: role.isSystem,
    permissions: role.permissions.map(({ permissionKey, effect }) => ({
      key: permissionKey,
      effect,
    })),
  };
}

function toRolePermissions(
  permissions: Partial<Record<PermissionKey, PermissionEffect>>,
) {
  return Object.entries(permissions).map(([permissionKey, effect]) => ({
    permissionKey,
    effect: effect as 'ALLOW' | 'DENY',
  }));
}

export class PrismaRbacRepository implements RbacRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getAuthorizationContext(
    userId: string,
    guildId: string,
  ): Promise<AuthorizationContext | null> {
    const membership = await this.prisma.guildMembership.findUnique({
      where: { userId_guildId: { userId, guildId } },
      include: {
        roleAssignments: {
          include: {
            role: {
              include: roleInclude,
            },
          },
        },
      },
    });

    if (!membership) {
      return null;
    }

    return {
      membershipId: membership.id,
      roles: membership.roleAssignments.map(({ role }) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        rank: role.rank,
        isSystem: role.isSystem,
        permissions: role.permissions.map(({ permissionKey, effect }) => ({
          key: permissionKey,
          effect,
        })),
      })),
    };
  }

  async listRoles(guildId: string): Promise<GuildRoleRecord[]> {
    const roles = await this.prisma.guildRole.findMany({
      where: { guildId },
      include: roleInclude,
      orderBy: [{ rank: 'desc' }, { name: 'asc' }],
    });
    return roles.map(mapRole);
  }

  async createCustomRole(input: {
    guildId: string;
    actorUserId: string;
    key: string;
    name: string;
    permissions: Partial<Record<PermissionKey, PermissionEffect>>;
  }): Promise<GuildRoleRecord> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const role = await transaction.guildRole.create({
          data: {
            guildId: input.guildId,
            key: input.key,
            name: input.name,
            rank: 5,
            permissions: {
              create: toRolePermissions(input.permissions),
            },
          },
          include: roleInclude,
        });

        await transaction.permissionAuditLog.create({
          data: {
            guildId: input.guildId,
            actorUserId: input.actorUserId,
            roleId: role.id,
            action: 'ROLE_CREATED',
            details: {
              roleKey: role.key,
              permissions: input.permissions,
            },
          },
        });

        return mapRole(role);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiError(
          409,
          'role_key_conflict',
          'A role with this name already exists.',
        );
      }
      throw error;
    }
  }

  async updateCustomRolePermissions(input: {
    guildId: string;
    actorUserId: string;
    roleId: string;
    permissions: Partial<Record<PermissionKey, PermissionEffect>>;
  }): Promise<GuildRoleRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const role = await transaction.guildRole.findFirst({
        where: {
          id: input.roleId,
          guildId: input.guildId,
          isSystem: false,
        },
        include: roleInclude,
      });

      if (!role) {
        return null;
      }

      await transaction.rolePermission.deleteMany({
        where: { roleId: role.id },
      });
      await transaction.rolePermission.createMany({
        data: toRolePermissions(input.permissions).map((permission) => ({
          ...permission,
          roleId: role.id,
        })),
      });
      const updatedRole = await transaction.guildRole.findUniqueOrThrow({
        where: { id: role.id },
        include: roleInclude,
      });

      await transaction.permissionAuditLog.create({
        data: {
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          roleId: role.id,
          action: 'ROLE_PERMISSIONS_UPDATED',
          details: { permissions: input.permissions },
        },
      });

      return mapRole(updatedRole);
    });
  }

  async assignRole(input: {
    guildId: string;
    actorUserId: string;
    targetUserId: string;
    roleId: string;
  }): Promise<'assigned' | 'not-found' | 'already-assigned'> {
    return this.prisma.$transaction(async (transaction) => {
      const [membership, role] = await Promise.all([
        transaction.guildMembership.findUnique({
          where: {
            userId_guildId: {
              userId: input.targetUserId,
              guildId: input.guildId,
            },
          },
        }),
        transaction.guildRole.findFirst({
          where: { id: input.roleId, guildId: input.guildId },
        }),
      ]);

      if (!membership || !role) {
        return 'not-found';
      }

      const assignment = await transaction.userGuildRole.findUnique({
        where: {
          membershipId_roleId: {
            membershipId: membership.id,
            roleId: role.id,
          },
        },
      });
      if (assignment) {
        return 'already-assigned';
      }

      await transaction.userGuildRole.create({
        data: { membershipId: membership.id, roleId: role.id },
      });
      await transaction.permissionAuditLog.create({
        data: {
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          targetUserId: input.targetUserId,
          roleId: role.id,
          action: 'ROLE_ASSIGNED',
          details: { roleKey: role.key },
        },
      });

      return 'assigned';
    });
  }

  async seedGuildRoles(
    transaction: Prisma.TransactionClient,
    guildId: string,
    membershipId: string,
  ): Promise<void> {
    for (const key of PERMISSIONS) {
      await transaction.permission.upsert({
        where: { key },
        create: { key, description: PERMISSION_DESCRIPTIONS[key] },
        update: { description: PERMISSION_DESCRIPTIONS[key] },
      });
    }

    for (const definition of DEFAULT_ROLES) {
      const role = await transaction.guildRole.upsert({
        where: { guildId_key: { guildId, key: definition.key } },
        create: {
          guildId,
          key: definition.key,
          name: definition.name,
          rank: definition.rank,
          isSystem: true,
        },
        update: {
          name: definition.name,
          rank: definition.rank,
          isSystem: true,
        },
      });
      for (const [permissionKey, effect] of Object.entries(
        definition.permissionEffects,
      )) {
        await transaction.rolePermission.upsert({
          where: {
            roleId_permissionKey: { roleId: role.id, permissionKey },
          },
          create: {
            roleId: role.id,
            permissionKey,
            effect,
          },
          update: { effect },
        });
      }
    }

    const ownerRole = await transaction.guildRole.findUniqueOrThrow({
      where: { guildId_key: { guildId, key: 'OWNER' } },
    });
    await transaction.userGuildRole.upsert({
      where: {
        membershipId_roleId: {
          membershipId,
          roleId: ownerRole.id,
        },
      },
      create: { membershipId, roleId: ownerRole.id },
      update: {},
    });
  }
}

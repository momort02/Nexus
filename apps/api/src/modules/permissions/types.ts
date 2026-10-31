import type { PermissionEffect, PermissionKey } from './catalog.js';

export interface EffectiveRole {
  id: string;
  key: string;
  name: string;
  rank: number;
  isSystem: boolean;
  permissions: Array<{
    key: string;
    effect: PermissionEffect;
  }>;
}

export interface AuthorizationContext {
  membershipId: string;
  roles: EffectiveRole[];
}

export interface GuildRoleRecord extends EffectiveRole {
  guildId: string;
}

export interface RbacRepository {
  getAuthorizationContext(
    userId: string,
    guildId: string,
  ): Promise<AuthorizationContext | null>;
  listRoles(guildId: string): Promise<GuildRoleRecord[]>;
  createCustomRole(input: {
    guildId: string;
    actorUserId: string;
    key: string;
    name: string;
    permissions: Partial<Record<PermissionKey, PermissionEffect>>;
  }): Promise<GuildRoleRecord>;
  updateCustomRolePermissions(input: {
    guildId: string;
    actorUserId: string;
    roleId: string;
    permissions: Partial<Record<PermissionKey, PermissionEffect>>;
  }): Promise<GuildRoleRecord | null>;
  assignRole(input: {
    guildId: string;
    actorUserId: string;
    targetUserId: string;
    roleId: string;
  }): Promise<'assigned' | 'not-found' | 'already-assigned'>;
}

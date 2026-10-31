import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type {
  AuthRepository,
  AuthSession,
  AuthUser,
  DiscordClient,
  DiscordGuild,
  GuildMembership,
} from '../src/modules/auth/types.js';
import {
  decryptAccessToken,
  hashSessionToken,
} from '../src/modules/auth/crypto.js';
import {
  DEFAULT_ROLES,
  type PermissionEffect,
  type PermissionKey,
} from '../src/modules/permissions/catalog.js';
import { AuthorizationService } from '../src/modules/permissions/authorization.service.js';
import { createHmac, randomUUID } from 'node:crypto';
import type { BotIngestionRepository } from '../src/modules/bot-ingestion/types.js';
import type { DiscordBotEvent } from '@nexus/shared';
import type {
  AnalyticsRepository,
  AnalyticsSummary,
} from '../src/modules/analytics/types.js';
import type {
  AuthorizationContext,
  EffectiveRole,
  GuildRoleRecord,
  RbacRepository,
} from '../src/modules/permissions/types.js';
import type { StaffModerationRepository } from '../src/modules/staff-moderation/types.js';

const userFixture: AuthUser = {
  id: 'user-1',
  discordId: '22222222222222222',
  username: 'nexus-user',
  globalName: 'Nexus User',
  avatar: null,
};

const guildA: DiscordGuild = {
  id: '11111111111111111',
  name: 'Guild A',
  owner: true,
  permissions: '0',
  icon: null,
};

const guildB: DiscordGuild = {
  id: '33333333333333333',
  name: 'Guild B',
  owner: false,
  permissions: '32',
  icon: null,
};

const guildC: DiscordGuild = {
  id: '44444444444444444',
  name: 'Guild C',
  owner: false,
  permissions: '0',
  icon: null,
};

const environment = {
  API_PORT: 3000,
  DATABASE_URL: 'postgresql://localhost:5432/nexus',
  APP_ORIGIN: 'http://localhost:5173',
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/discord/callback',
  BOT_API_SECRET: 'b'.repeat(64),
  OAUTH_ENCRYPTION_KEY: 'a'.repeat(64),
  NODE_ENV: 'test',
} as const;

function createBotSignature(
  method: string,
  path: string,
  body: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const signature = createHmac('sha256', environment.BOT_API_SECRET)
    .update(
      ['nexus-v1', timestamp, nonce, method.toUpperCase(), path, body].join(
        '\n',
      ),
    )
    .digest('hex');
  return {
    'X-Nexus-Timestamp': timestamp,
    'X-Nexus-Nonce': nonce,
    'X-Nexus-Signature': signature,
  };
}

class MemoryAuthRepository implements AuthRepository {
  readonly sessions = new Map<string, AuthSession>();
  readonly memberships = new Map<string, GuildMembership>();
  private readonly users = new Map<string, AuthUser>();

  async upsertUser(user: Omit<AuthUser, 'id'>): Promise<AuthUser> {
    const stored = { ...userFixture, ...user };
    this.users.set(stored.id, stored);
    return stored;
  }

  async createSession(session: {
    id: string;
    userId: string;
    encryptedAccessToken: string;
    accessTokenExpiresAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    const user = this.users.get(session.userId);
    if (!user) {
      throw new Error('Test user does not exist.');
    }

    this.sessions.set(session.id, {
      ...session,
      selectedGuildId: null,
      user,
    });
  }

  async findSession(id: string): Promise<AuthSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async clearAccessToken(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      this.sessions.set(id, {
        ...session,
        encryptedAccessToken: null,
        accessTokenExpiresAt: null,
      });
    }
  }

  async listMemberships(userId: string): Promise<GuildMembership[]> {
    return [...this.memberships.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, membership]) => membership);
  }

  async getMembership(
    userId: string,
    guildId: string,
  ): Promise<GuildMembership | null> {
    return this.memberships.get(`${userId}:${guildId}`) ?? null;
  }

  async createOrSelectGuild(
    userId: string,
    guild: Pick<DiscordGuild, 'id' | 'name'>,
    sessionId: string,
  ): Promise<'created' | 'selected' | 'not-authorized'> {
    const existing = await this.getMembership(userId, guild.id);
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Test session does not exist.');
    }

    const membership = {
      id: guild.id,
      name: guild.name,
      role: 'OWNER',
    };
    this.memberships.set(`${userId}:${guild.id}`, membership);
    this.sessions.set(sessionId, { ...session, selectedGuildId: guild.id });
    return existing ? 'selected' : 'created';
  }
}

class MemoryRbacRepository implements RbacRepository {
  readonly contexts = new Map<string, AuthorizationContext>();
  readonly roles = new Map<string, GuildRoleRecord>();
  readonly memberIds = new Set<string>();
  readonly assignments = new Set<string>();
  readonly auditEvents: string[] = [];

  constructor() {
    const ownerDefinition = DEFAULT_ROLES.find((role) => role.key === 'OWNER');
    if (!ownerDefinition) {
      throw new Error('Owner role definition is missing.');
    }

    const ownerRole: EffectiveRole = {
      id: 'guild-a-owner',
      key: ownerDefinition.key,
      name: ownerDefinition.name,
      rank: ownerDefinition.rank,
      isSystem: true,
      permissions: Object.entries(ownerDefinition.permissionEffects).map(
        ([key, effect]) => ({
          key,
          effect: effect as PermissionEffect,
        }),
      ),
    };
    this.roles.set(ownerRole.id, {
      ...ownerRole,
      guildId: guildA.id,
    });
    this.contexts.set(`${userFixture.id}:${guildA.id}`, {
      membershipId: `${userFixture.id}:${guildA.id}`,
      roles: [ownerRole],
    });
    this.memberIds.add(`${userFixture.id}:${guildA.id}`);
  }

  async getAuthorizationContext(
    userId: string,
    guildId: string,
  ): Promise<AuthorizationContext | null> {
    return this.contexts.get(`${userId}:${guildId}`) ?? null;
  }

  async listRoles(guildId: string): Promise<GuildRoleRecord[]> {
    return [...this.roles.values()].filter((role) => role.guildId === guildId);
  }

  async createCustomRole(input: {
    guildId: string;
    actorUserId: string;
    key: string;
    name: string;
    permissions: Partial<Record<PermissionKey, PermissionEffect>>;
  }): Promise<GuildRoleRecord> {
    const role: GuildRoleRecord = {
      id: `${input.guildId}:${input.key}`,
      guildId: input.guildId,
      key: input.key,
      name: input.name,
      rank: 5,
      isSystem: false,
      permissions: Object.entries(input.permissions).map(([key, effect]) => ({
        key,
        effect: effect as PermissionEffect,
      })),
    };
    this.roles.set(role.id, role);
    this.auditEvents.push('ROLE_CREATED');
    return role;
  }

  async updateCustomRolePermissions(input: {
    guildId: string;
    actorUserId: string;
    roleId: string;
    permissions: Partial<Record<PermissionKey, PermissionEffect>>;
  }): Promise<GuildRoleRecord | null> {
    const role = this.roles.get(input.roleId);
    if (!role || role.guildId !== input.guildId || role.isSystem) {
      return null;
    }

    const updated = {
      ...role,
      permissions: Object.entries(input.permissions).map(([key, effect]) => ({
        key,
        effect: effect as PermissionEffect,
      })),
    };
    this.roles.set(role.id, updated);
    this.auditEvents.push('ROLE_PERMISSIONS_UPDATED');
    return updated;
  }

  async assignRole(input: {
    guildId: string;
    actorUserId: string;
    targetUserId: string;
    roleId: string;
  }): Promise<'assigned' | 'not-found' | 'already-assigned'> {
    const role = this.roles.get(input.roleId);
    const memberKey = `${input.targetUserId}:${input.guildId}`;
    if (
      !role ||
      role.guildId !== input.guildId ||
      !this.memberIds.has(memberKey)
    ) {
      return 'not-found';
    }
    const assignmentKey = `${memberKey}:${role.id}`;
    if (this.assignments.has(assignmentKey)) {
      return 'already-assigned';
    }
    this.assignments.add(assignmentKey);
    this.auditEvents.push('ROLE_ASSIGNED');
    return 'assigned';
  }
}

class MemoryBotIngestionRepository implements BotIngestionRepository {
  readonly events = new Map<string, DiscordBotEvent>();
  readonly requestNonces = new Set<string>();

  async consumeRequestNonce(nonce: string): Promise<boolean> {
    if (this.requestNonces.has(nonce)) {
      return false;
    }
    this.requestNonces.add(nonce);
    return true;
  }

  async ingest(event: DiscordBotEvent) {
    if (event.guildId !== guildA.id) {
      return 'unknown-guild' as const;
    }
    if (this.events.has(event.eventId)) {
      return 'duplicate' as const;
    }
    this.events.set(event.eventId, event);
    return 'processed' as const;
  }
}

class MemoryAnalyticsRepository implements AnalyticsRepository {
  readonly timezones = new Map<string, string>([[guildA.id, 'UTC']]);

  async getTimezone(guildId: string): Promise<string | null> {
    return this.timezones.get(guildId) ?? null;
  }

  async updateTimezone(guildId: string, timezone: string): Promise<boolean> {
    this.timezones.set(guildId, timezone);
    return true;
  }

  async getSummary(input: {
    guildId: string;
    from: string;
    to: string;
    timezone: string;
  }): Promise<AnalyticsSummary> {
    return {
      timezone: input.timezone,
      from: input.from,
      to: input.to,
      observedFrom: null,
      series: [],
      totals: {
        messageCount: 0,
        joins: 0,
        leaves: 0,
        activeMemberDays: 0,
        uniqueActiveMembers: 0,
      },
      active: { dau: 0, wau: 0, mau: 0 },
    };
  }

  async countUniqueActiveMembers(): Promise<number> {
    return 0;
  }

  async listChannels(): Promise<{ channels: []; total: number }> {
    return { channels: [], total: 0 };
  }
}

class MemoryStaffModerationRepository implements StaffModerationRepository {
  readonly memberSnapshots: Array<{
    discordUserId: string;
    displayName: string | null;
    joinedAt: Date | null;
    roleIds: string[];
    syncedAt: Date;
  }> = [];
  readonly tasks: Array<Record<string, unknown>> = [];
  readonly reports: Array<Record<string, unknown>> = [];
  readonly applications: Array<Record<string, unknown>> = [];
  readonly cases: Array<Record<string, unknown>> = [];
  actionsToClaim: Awaited<
    ReturnType<StaffModerationRepository['claimModerationActions']>
  > = [];
  readonly completedActions: Array<{
    id: string;
    success: boolean;
    message: string;
  }> = [];

  async listMembers() {
    return {
      members: this.memberSnapshots,
      total: this.memberSnapshots.length,
    };
  }

  async listStaff(): Promise<unknown[]> {
    return [];
  }
  async upsertStaff(
    input: Parameters<StaffModerationRepository['upsertStaff']>[0],
  ) {
    return input;
  }
  async listTeams(): Promise<unknown[]> {
    return [];
  }
  async createTeam(
    input: Parameters<StaffModerationRepository['createTeam']>[0],
  ) {
    return input;
  }
  async addTeamMember(): Promise<boolean> {
    return true;
  }
  async listTasks(): Promise<unknown[]> {
    return this.tasks;
  }
  async createTask(
    input: Parameters<StaffModerationRepository['createTask']>[0],
  ) {
    const task = { id: 'task-1', ...input };
    this.tasks.push(task);
    return task;
  }
  async updateTask(
    input: Parameters<StaffModerationRepository['updateTask']>[0],
  ) {
    return this.tasks.find((task) => task.id === input.taskId) ?? null;
  }
  async listReports(): Promise<unknown[]> {
    return this.reports;
  }
  async createReport(
    input: Parameters<StaffModerationRepository['createReport']>[0],
  ) {
    const report = { id: 'report-1', ...input };
    this.reports.push(report);
    return report;
  }
  async updateReport(
    input: Parameters<StaffModerationRepository['updateReport']>[0],
  ) {
    return { id: input.reportId, ...input };
  }
  async listApplications(): Promise<unknown[]> {
    return this.applications;
  }
  async createApplication(
    input: Parameters<StaffModerationRepository['createApplication']>[0],
  ) {
    const application = { id: 'application-1', ...input };
    this.applications.push(application);
    return application;
  }
  async updateApplication(
    input: Parameters<StaffModerationRepository['updateApplication']>[0],
  ) {
    return { id: input.applicationId, ...input };
  }
  async listCases(): Promise<unknown[]> {
    return this.cases;
  }
  async createModerationCase(
    input: Parameters<StaffModerationRepository['createModerationCase']>[0],
  ) {
    const moderationCase = { id: 'case-1', status: 'PENDING', ...input };
    this.cases.push(moderationCase);
    return moderationCase;
  }
  async createAppeal(
    input: Parameters<StaffModerationRepository['createAppeal']>[0],
  ) {
    return { id: 'appeal-1', ...input };
  }
  async listAppeals(): Promise<unknown[]> {
    return [];
  }
  async updateAppeal(
    input: Parameters<StaffModerationRepository['updateAppeal']>[0],
  ) {
    return { id: input.appealId, ...input };
  }
  async listAudit(): Promise<unknown[]> {
    return [];
  }
  async listNotifications(): Promise<unknown[]> {
    return [];
  }
  async markNotificationRead(): Promise<boolean> {
    return true;
  }
  async claimModerationActions(): Promise<
    Awaited<ReturnType<StaffModerationRepository['claimModerationActions']>>
  > {
    const actions = this.actionsToClaim;
    this.actionsToClaim = [];
    return actions;
  }
  async completeModerationAction(input: {
    id: string;
    success: boolean;
    message: string;
  }): Promise<boolean> {
    this.completedActions.push(input);
    return true;
  }
}

function createTestApp(
  repository = new MemoryAuthRepository(),
  publishGuildEvent?: (guildId: string) => void | Promise<void>,
) {
  const rbacRepository = new MemoryRbacRepository();
  const botIngestionRepository = new MemoryBotIngestionRepository();
  const analyticsRepository = new MemoryAnalyticsRepository();
  const staffModerationRepository = new MemoryStaffModerationRepository();
  return {
    app: createApp({
      repository,
      rbacRepository,
      botIngestionRepository,
      analyticsRepository,
      staffModerationRepository,
      botApiSecret: environment.BOT_API_SECRET,
      discord: createDiscordClient(),
      environment,
      ...(publishGuildEvent ? { publishGuildEvent } : {}),
    }),
    repository,
    rbacRepository,
    botIngestionRepository,
    analyticsRepository,
    staffModerationRepository,
  };
}

function createDiscordClient(): DiscordClient {
  return {
    async exchangeCode(code) {
      expect(code).toBe('valid-code');
      return { accessToken: 'discord-access-token', expiresIn: 3600 };
    },
    async getUser(accessToken) {
      expect(accessToken).toBe('discord-access-token');
      return {
        id: userFixture.discordId,
        username: userFixture.username,
        global_name: userFixture.globalName,
        avatar: null,
      };
    },
    async getGuilds(accessToken) {
      expect(accessToken).toBe('discord-access-token');
      return [guildA, guildB, guildC];
    },
  };
}

function getSetCookieHeaders(response: {
  headers: Record<string, unknown>;
}): string[] {
  const header = response.headers['set-cookie'];
  if (typeof header === 'string') {
    return [header];
  }
  if (Array.isArray(header)) {
    return header.filter((value): value is string => typeof value === 'string');
  }
  return [];
}

async function signIn(
  app: ReturnType<typeof createApp>,
): Promise<{ cookie: string; state: string }> {
  const authorization = await request(app).get('/api/v1/auth/discord');
  const location = authorization.headers.location;
  if (!location) {
    throw new Error('OAuth authorization URL is missing.');
  }
  const authorizationUrl = new URL(location);
  const state = authorizationUrl.searchParams.get('state');
  const stateCookieHeader = getSetCookieHeaders(authorization).find(
    (cookie: string) => cookie.startsWith('nexus_oauth_state='),
  );
  const stateCookie = stateCookieHeader?.split(';', 1)[0];

  expect(authorizationUrl.searchParams.get('scope')).toBe('identify guilds');
  expect(location).not.toContain(environment.DISCORD_CLIENT_SECRET);
  expect(stateCookieHeader).toMatch(/HttpOnly/i);
  expect(stateCookieHeader).toMatch(/SameSite=Lax/i);

  if (!state || !stateCookie) {
    throw new Error('OAuth state or state cookie is missing.');
  }
  expect(state).toMatch(/^[\da-f]{64}$/);
  expect(stateCookie).toBe(`nexus_oauth_state=${state}`);

  const callback = await request(app)
    .get('/api/v1/auth/discord/callback')
    .query({ code: 'valid-code', state })
    .set('Cookie', stateCookie);
  const sessionCookieHeader = getSetCookieHeaders(callback).find(
    (cookie: string) => cookie.startsWith('nexus_session='),
  );
  const sessionCookie = sessionCookieHeader?.split(';', 1)[0];

  expect(callback.status).toBe(302);
  expect(callback.headers.location).toBe(environment.APP_ORIGIN);
  expect(sessionCookieHeader).toMatch(/HttpOnly/i);
  expect(sessionCookieHeader).toMatch(/SameSite=Lax/i);
  if (!sessionCookie) {
    throw new Error('Session cookie was not set.');
  }
  return { cookie: sessionCookie, state };
}

describe('Discord OAuth and guild isolation', () => {
  it('verifies OAuth state and never returns OAuth tokens to the browser', async () => {
    const { app, repository } = createTestApp();
    const authorization = await request(app).get('/api/v1/auth/discord');
    const location = authorization.headers.location;
    if (!location) {
      throw new Error('OAuth authorization URL is missing.');
    }
    const state = new URL(location).searchParams.get('state');
    if (!state) {
      throw new Error('OAuth state is missing.');
    }

    const invalidCallback = await request(app)
      .get('/api/v1/auth/discord/callback')
      .query({ code: 'valid-code', state })
      .set('Cookie', 'nexus_oauth_state=wrong-state');
    expect(invalidCallback.status).toBe(400);

    const { cookie } = await signIn(app);
    const me = await request(app).get('/api/v1/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      user: userFixture,
      selectedGuildId: null,
    });
    expect(JSON.stringify(me.body)).not.toContain('discord-access-token');

    const storedSession = [...repository.sessions.values()][0];
    if (!storedSession?.encryptedAccessToken) {
      throw new Error('Encrypted OAuth token was not stored.');
    }
    expect(storedSession.encryptedAccessToken).not.toContain(
      'discord-access-token',
    );
    expect(
      decryptAccessToken(
        storedSession.encryptedAccessToken,
        environment.OAUTH_ENCRYPTION_KEY,
      ),
    ).toBe('discord-access-token');
  });

  it('allows the selected guild and denies a different guild', async () => {
    const { app } = createTestApp();
    const { cookie } = await signIn(app);

    const availableGuilds = await request(app)
      .get('/api/v1/guilds/available')
      .set('Cookie', cookie);
    expect(availableGuilds.status).toBe(200);
    expect(availableGuilds.body.guilds).toEqual([
      expect.objectContaining({ id: guildA.id, canCreateNexus: true }),
      expect.objectContaining({ id: guildB.id, canCreateNexus: true }),
      expect.objectContaining({ id: guildC.id, canCreateNexus: false }),
    ]);

    const unauthorizedSelection = await request(app)
      .post(`/api/v1/guilds/${guildC.id}/select`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN);
    expect(unauthorizedSelection.status).toBe(403);

    const selected = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/select`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN);
    expect(selected.status).toBe(200);
    expect(selected.body).toEqual({
      selectedGuildId: guildA.id,
      created: true,
    });

    const allowedGuild = await request(app)
      .get(`/api/v1/guilds/${guildA.id}`)
      .set('Cookie', cookie);
    expect(allowedGuild.status).toBe(200);
    expect(allowedGuild.body.guild.id).toBe(guildA.id);

    const otherGuild = await request(app)
      .get(`/api/v1/guilds/${guildB.id}`)
      .set('Cookie', cookie);
    expect(otherGuild.status).toBe(403);
    expect(otherGuild.body.error.code).toBe('guild_access_denied');
  });

  it('requires a same-origin POST to log out and deletes the session', async () => {
    const { app, repository } = createTestApp();
    const { cookie } = await signIn(app);
    const sessionHash = hashSessionToken(cookie.slice('nexus_session='.length));

    const rejected = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://attacker.example');
    expect(rejected.status).toBe(403);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN);
    expect(logout.status).toBe(204);
    expect(repository.sessions.has(sessionHash)).toBe(false);
  });

  it('clears expired Discord credentials while keeping the Nexus session', async () => {
    const { app, repository } = createTestApp();
    const { cookie } = await signIn(app);
    const sessionHash = hashSessionToken(cookie.slice('nexus_session='.length));
    const storedSession = repository.sessions.get(sessionHash);
    if (!storedSession) {
      throw new Error('Test session was not created.');
    }

    repository.sessions.set(sessionHash, {
      ...storedSession,
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    });

    const me = await request(app).get('/api/v1/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(
      repository.sessions.get(sessionHash)?.encryptedAccessToken,
    ).toBeNull();

    const availableGuilds = await request(app)
      .get('/api/v1/guilds/available')
      .set('Cookie', cookie);
    expect(availableGuilds.status).toBe(401);
    expect(availableGuilds.body.error.code).toBe('discord_reauth_required');
  });

  it('protects role routes with backend permissions and guild membership', async () => {
    const { app, repository, rbacRepository } = createTestApp();
    const { cookie } = await signIn(app);
    await request(app)
      .post(`/api/v1/guilds/${guildA.id}/select`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .expect(200);

    const roles = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/roles`)
      .set('Cookie', cookie);
    expect(roles.status).toBe(200);
    expect(roles.body.roles).toEqual([
      expect.objectContaining({ key: 'OWNER', isSystem: true }),
    ]);

    const createdRole = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/roles`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({
        name: 'Support Team',
        permissions: { 'dashboard.view': 'ALLOW' },
      });
    expect(createdRole.status).toBe(201);
    expect(createdRole.body.role.key).toBe('CUSTOM_SUPPORT_TEAM');
    expect(rbacRepository.auditEvents).toContain('ROLE_CREATED');

    const updatedRole = await request(app)
      .put(
        `/api/v1/guilds/${guildA.id}/roles/${createdRole.body.role.id}/permissions`,
      )
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({
        permissions: {
          'dashboard.view': 'ALLOW',
          'analytics.view': 'ALLOW',
        },
      });
    expect(updatedRole.status).toBe(200);
    expect(updatedRole.body.role.permissions).toEqual([
      { key: 'dashboard.view', effect: 'ALLOW' },
      { key: 'analytics.view', effect: 'ALLOW' },
    ]);
    expect(rbacRepository.auditEvents).toContain('ROLE_PERMISSIONS_UPDATED');

    repository.memberships.set(`user-target:${guildA.id}`, {
      id: guildA.id,
      name: guildA.name,
      role: 'MEMBER',
    });
    rbacRepository.memberIds.add(`user-target:${guildA.id}`);
    const assignment = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/role-assignments`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({
        userId: 'user-target',
        roleId: createdRole.body.role.id,
      });
    expect(assignment.status).toBe(204);
    expect(rbacRepository.auditEvents).toContain('ROLE_ASSIGNED');

    const duplicateAssignment = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/role-assignments`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({
        userId: 'user-target',
        roleId: createdRole.body.role.id,
      });
    expect(duplicateAssignment.status).toBe(409);

    const otherGuildRoles = await request(app)
      .get(`/api/v1/guilds/${guildB.id}/roles`)
      .set('Cookie', cookie);
    expect(otherGuildRoles.status).toBe(403);
    expect(otherGuildRoles.body.error.code).toBe('guild_access_denied');

    const selfAssignment = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/role-assignments`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({ userId: userFixture.id, roleId: 'guild-a-owner' });
    expect(selfAssignment.status).toBe(403);
    expect(selfAssignment.body.error.code).toBe('self_role_assignment_denied');

    rbacRepository.contexts.set(`${userFixture.id}:${guildA.id}`, {
      membershipId: `${userFixture.id}:${guildA.id}`,
      roles: [
        {
          id: 'guild-a-viewer',
          key: 'VIEWER',
          name: 'Viewer',
          rank: 10,
          isSystem: true,
          permissions: [{ key: 'dashboard.view', effect: 'ALLOW' }],
        },
      ],
    });
    const deniedRoleList = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/roles`)
      .set('Cookie', cookie);
    expect(deniedRoleList.status).toBe(403);
    expect(deniedRoleList.body.error.code).toBe('permission_denied');
  });
});

describe('staff and moderation authorization', () => {
  it('serves guild-scoped member snapshots only with members.view', async () => {
    const { app, repository, rbacRepository, staffModerationRepository } =
      createTestApp();
    const session = await signIn(app);
    repository.memberships.set(`${userFixture.id}:${guildA.id}`, {
      id: guildA.id,
      name: guildA.name,
      role: 'OWNER',
    });
    rbacRepository.memberIds.add(`${userFixture.id}:${guildA.id}`);
    staffModerationRepository.memberSnapshots.push({
      discordUserId: '66666666666666666',
      displayName: 'Amaury',
      joinedAt: new Date('2026-10-01T10:00:00.000Z'),
      roleIds: [],
      syncedAt: new Date('2026-10-31T12:00:00.000Z'),
    });

    const authorized = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/members?page=1&pageSize=10`)
      .set('Cookie', session.cookie);

    expect(authorized.status).toBe(200);
    expect(authorized.body).toMatchObject({
      members: [
        expect.objectContaining({
          discordUserId: '66666666666666666',
          displayName: 'Amaury',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      pages: 1,
    });

    const crossGuild = await request(app)
      .get(`/api/v1/guilds/${guildB.id}/members`)
      .set('Cookie', session.cookie);
    expect(crossGuild.status).toBe(403);

    const invalidFilter = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/members?roleId=invalid`)
      .set('Cookie', session.cookie);
    expect(invalidFilter.status).toBe(400);
  });

  async function selectGuild(
    app: ReturnType<typeof createApp>,
    cookie: string,
  ) {
    await request(app)
      .post(`/api/v1/guilds/${guildA.id}/select`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .expect(200);
  }

  it('creates staff workflows, keeps records guild-scoped, and gates private reads', async () => {
    const { app, rbacRepository } = createTestApp();
    const { cookie } = await signIn(app);
    await selectGuild(app, cookie);

    const task = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/tasks`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({ title: 'Review queue', description: 'Check pending reports.' });
    expect(task.status).toBe(201);
    expect(task.body.task).toMatchObject({
      title: 'Review queue',
      description: 'Check pending reports.',
    });

    const completed = await request(app)
      .patch(`/api/v1/guilds/${guildA.id}/tasks/task-1`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({ status: 'COMPLETED', comment: 'Reviewed.' });
    expect(completed.status).toBe(200);

    const report = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/reports`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({
        targetDiscordId: '55555555555555555',
        category: 'harassment',
        details: 'User-submitted report details.',
      });
    expect(report.status).toBe(201);

    const application = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/applications`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({ answers: { motivation: 'Helping the community.' } });
    expect(application.status).toBe(201);

    const otherGuild = await request(app)
      .get(`/api/v1/guilds/${guildB.id}/tasks`)
      .set('Cookie', cookie);
    expect(otherGuild.status).toBe(403);
    expect(otherGuild.body.error.code).toBe('guild_access_denied');

    rbacRepository.contexts.set(`${userFixture.id}:${guildA.id}`, {
      membershipId: `${userFixture.id}:${guildA.id}`,
      roles: [
        {
          id: 'guild-a-viewer',
          key: 'VIEWER',
          name: 'Viewer',
          rank: 10,
          isSystem: true,
          permissions: [{ key: 'dashboard.view', effect: 'ALLOW' }],
        },
      ],
    });
    const privateReports = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/reports`)
      .set('Cookie', cookie);
    expect(privateReports.status).toBe(403);
    expect(privateReports.body.error.code).toBe('permission_denied');

    const privateApplications = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/applications`)
      .set('Cookie', cookie);
    expect(privateApplications.status).toBe(403);
  });

  it('queues warnings but refuses Discord actions without the actor Discord permission', async () => {
    const { app, staffModerationRepository } = createTestApp();
    const { cookie } = await signIn(app);
    await selectGuild(app, cookie);

    const warning = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/moderation/cases`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({
        targetDiscordId: '55555555555555555',
        action: 'WARN',
        reason: 'Please follow the server rules.',
      });
    expect(warning.status).toBe(202);
    expect(warning.body.case.status).toBe('PENDING');
    expect(staffModerationRepository.cases).toHaveLength(1);

    const timeout = await request(app)
      .post(`/api/v1/guilds/${guildA.id}/moderation/cases`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({
        targetDiscordId: '55555555555555555',
        action: 'TIMEOUT',
        reason: 'Repeated disruption.',
        durationSeconds: 300,
      });
    expect(timeout.status).toBe(403);
    expect(timeout.body.error.code).toBe('discord_permission_denied');
    expect(staffModerationRepository.cases).toHaveLength(1);
  });

  it('requires a valid HMAC signature for bot moderation queue requests', async () => {
    const { app } = createTestApp();
    const path = '/api/internal/v1/moderation/actions/claim';
    const body = '{}';
    const headers = createBotSignature('POST', path, body);
    const response = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body.actions).toEqual([]);

    const replay = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(body);
    expect(replay.status).toBe(401);

    const crossEndpoint = await request(app)
      .post('/api/internal/v1/discord/events')
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(body);
    expect(crossEndpoint.status).toBe(401);

    const invalid = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set({
        ...createBotSignature('POST', path, body),
        'X-Nexus-Signature': '0'.repeat(64),
      })
      .send(body);
    expect(invalid.status).toBe(401);
  });

  it('does not release queued actions after the actor loses Nexus permission', async () => {
    const { app, rbacRepository, staffModerationRepository } = createTestApp();
    staffModerationRepository.actionsToClaim = [
      {
        id: 'moderation-action-1',
        guildId: guildA.id,
        caseId: 'case-1',
        status: 'PROCESSING',
        case: {
          targetDiscordId: '55555555555555555',
          actorUserId: userFixture.id,
          actorDiscordId: userFixture.discordId,
          action: 'BAN',
          reason: 'Reason',
          durationSeconds: null,
        },
      },
    ];
    rbacRepository.contexts.set(`${userFixture.id}:${guildA.id}`, {
      membershipId: `${userFixture.id}:${guildA.id}`,
      roles: [
        {
          id: 'guild-a-viewer',
          key: 'VIEWER',
          name: 'Viewer',
          rank: 10,
          isSystem: true,
          permissions: [{ key: 'dashboard.view', effect: 'ALLOW' }],
        },
      ],
    });

    const path = '/api/internal/v1/moderation/actions/claim';
    const body = '{}';
    const response = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set(createBotSignature('POST', path, body))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.actions).toEqual([]);
    expect(staffModerationRepository.completedActions).toEqual([
      {
        id: 'moderation-action-1',
        success: false,
        message: 'La permission Nexus a été révoquée avant exécution.',
      },
    ]);
  });
});

describe('AuthorizationService', () => {
  it('applies default roles, explicit deny precedence, and tenant isolation', async () => {
    const repository = new MemoryRbacRepository();
    const analystDefinition = DEFAULT_ROLES.find(
      (role) => role.key === 'ANALYST',
    );
    if (!analystDefinition) {
      throw new Error('Analyst role definition is missing.');
    }

    repository.contexts.set('analyst-user:guild-a', {
      membershipId: 'analyst-membership',
      roles: [
        {
          id: 'analyst-role',
          key: analystDefinition.key,
          name: analystDefinition.name,
          rank: analystDefinition.rank,
          isSystem: true,
          permissions: Object.entries(analystDefinition.permissionEffects).map(
            ([key, effect]) => ({
              key,
              effect: effect as PermissionEffect,
            }),
          ),
        },
      ],
    });

    const authorization = new AuthorizationService(repository);
    expect(
      await authorization.hasPermission(
        'analyst-user',
        'guild-a',
        'analytics.view',
      ),
    ).toBe(true);
    expect(
      await authorization.hasPermission(
        'analyst-user',
        'guild-a',
        'moderation.ban',
      ),
    ).toBe(false);
    expect(
      await authorization.hasPermission(
        'analyst-user',
        'guild-b',
        'analytics.view',
      ),
    ).toBe(false);

    const moderatorDefinition = DEFAULT_ROLES.find(
      (role) => role.key === 'MODERATOR',
    );
    if (!moderatorDefinition) {
      throw new Error('Moderator role definition is missing.');
    }
    repository.contexts.set('staff-user:guild-a', {
      membershipId: 'staff-membership',
      roles: [
        {
          id: 'moderator-role',
          key: moderatorDefinition.key,
          name: moderatorDefinition.name,
          rank: moderatorDefinition.rank,
          isSystem: true,
          permissions: Object.entries(
            moderatorDefinition.permissionEffects,
          ).map(([key, effect]) => ({
            key,
            effect: effect as PermissionEffect,
          })),
        },
        {
          id: 'denial-role',
          key: 'CUSTOM_DENIAL',
          name: 'Denial',
          rank: 5,
          isSystem: false,
          permissions: [{ key: 'moderation.warn', effect: 'DENY' }],
        },
      ],
    });
    expect(
      await authorization.hasPermission(
        'staff-user',
        'guild-a',
        'moderation.warn',
      ),
    ).toBe(false);
    expect(
      await authorization.hasPermission(
        userFixture.id,
        guildA.id,
        'moderation.warn',
      ),
    ).toBe(true);
  });

  it('rejects granting permissions the actor does not hold', async () => {
    const repository = new MemoryRbacRepository();
    repository.contexts.set('viewer-user:guild-a', {
      membershipId: 'viewer-membership',
      roles: [
        {
          id: 'viewer-role',
          key: 'VIEWER',
          name: 'Viewer',
          rank: 10,
          isSystem: true,
          permissions: [{ key: 'dashboard.view', effect: 'ALLOW' }],
        },
      ],
    });

    const authorization = new AuthorizationService(repository);
    await expect(
      authorization.createRole('viewer-user', 'guild-a', {
        key: 'CUSTOM_ADMIN',
        name: 'Custom Admin',
        permissions: { 'server.delete': 'ALLOW' },
      }),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 });
  });

  it('requires both Nexus and Discord permissions for Discord actions', async () => {
    const authorization = new AuthorizationService(new MemoryRbacRepository());
    const resolveDiscordPermissions = async () => 0b1010n;

    await expect(
      authorization.assertDiscordPermission(
        userFixture.id,
        guildA.id,
        'moderation.ban',
        0b0010n,
        resolveDiscordPermissions,
      ),
    ).resolves.toBeUndefined();
    await expect(
      authorization.assertDiscordPermission(
        userFixture.id,
        guildA.id,
        'moderation.ban',
        0b0100n,
        resolveDiscordPermissions,
      ),
    ).rejects.toMatchObject({
      code: 'discord_permission_denied',
      status: 403,
    });
    await expect(
      authorization.assertDiscordPermission(
        'unknown-user',
        guildA.id,
        'moderation.ban',
        0n,
        resolveDiscordPermissions,
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 });

    await expect(
      authorization.createRole(userFixture.id, guildA.id, {
        key: 'CUSTOM_DELETE',
        name: 'Delete Access',
        permissions: { 'server.delete': 'ALLOW' },
      }),
    ).rejects.toMatchObject({ code: 'protected_permission', status: 403 });
  });
});

describe('Discord bot event ingestion', () => {
  it('authenticates, validates, and deduplicates event batches', async () => {
    const publishGuildEvent = vi.fn();
    const { app, botIngestionRepository } = createTestApp(
      new MemoryAuthRepository(),
      publishGuildEvent,
    );
    const event: DiscordBotEvent = {
      type: 'message.count',
      eventId: 'a'.repeat(64),
      guildId: guildA.id,
      channelId: '55555555555555555',
      memberKey: 'c'.repeat(64),
      bucketStart: '2026-10-31T10:00:00.000Z',
      occurredAt: '2026-10-31T10:01:00.000Z',
    };
    const body = JSON.stringify({ events: [event] });
    const path = '/api/internal/v1/discord/events';
    const sendSigned = (headers = createBotSignature('POST', path, body)) =>
      request(app)
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(body);

    const firstHeaders = createBotSignature('POST', path, body);
    const first = await sendSigned(firstHeaders);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ processed: 1, duplicates: 0, ignored: 0 });
    expect(publishGuildEvent).toHaveBeenCalledOnce();
    expect(publishGuildEvent).toHaveBeenCalledWith(guildA.id);

    const duplicate = await sendSigned();
    expect(duplicate.status).toBe(202);
    expect(duplicate.body).toEqual({
      processed: 0,
      duplicates: 1,
      ignored: 0,
    });
    expect(publishGuildEvent).toHaveBeenCalledTimes(1);
    const replay = await sendSigned(firstHeaders);
    expect(replay.status).toBe(401);
    expect(botIngestionRepository.events.size).toBe(1);
  });

  it('rejects invalid signatures and ignores events for unregistered guilds', async () => {
    const { app } = createTestApp();
    const invalidSignature = await request(app)
      .post('/api/internal/v1/discord/events')
      .set('X-Nexus-Timestamp', Math.floor(Date.now() / 1000).toString())
      .set('X-Nexus-Signature', '0'.repeat(64))
      .send({ events: [] });
    expect(invalidSignature.status).toBe(401);

    const event: DiscordBotEvent = {
      type: 'member.left',
      eventId: 'b'.repeat(64),
      guildId: guildB.id,
      discordUserId: '66666666666666666',
      occurredAt: '2026-10-31T10:01:00.000Z',
    };
    const body = JSON.stringify({ events: [event] });
    const path = '/api/internal/v1/discord/events';
    const unknownGuild = await request(app)
      .post(path)
      .set(createBotSignature('POST', path, body))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(unknownGuild.status).toBe(202);
    expect(unknownGuild.body).toEqual({
      processed: 0,
      duplicates: 0,
      ignored: 1,
    });
  });
});

describe('Server analytics authorization', () => {
  it('serves tenant-scoped summaries and rejects cross-guild reads', async () => {
    const { app, analyticsRepository } = createTestApp();
    const { cookie } = await signIn(app);
    await request(app)
      .post(`/api/v1/guilds/${guildA.id}/select`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .expect(200);

    const summary = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/analytics/overview`)
      .query({
        from: '2026-10-25',
        to: '2026-10-31',
        compareFrom: '2026-10-18',
        compareTo: '2026-10-24',
      })
      .set('Cookie', cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.summary.timezone).toBe('UTC');
    expect(summary.body.comparison.from).toBe('2026-10-18');

    const dashboard = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/dashboard`)
      .set('Cookie', cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.summary.timezone).toBe('UTC');

    const settings = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/settings`)
      .set('Cookie', cookie);
    expect(settings.status).toBe(200);
    expect(settings.body.settings.analyticsTimezone).toBe('UTC');

    const channelPage = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/analytics/channels`)
      .query({ from: '2026-10-25', to: '2026-10-31', page: 1, pageSize: 10 })
      .set('Cookie', cookie);
    expect(channelPage.status).toBe(200);
    expect(channelPage.body).toMatchObject({
      page: 1,
      pageSize: 10,
      pages: 0,
      timezone: 'UTC',
    });

    const csv = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/analytics/export.csv`)
      .query({ from: '2026-10-25', to: '2026-10-31' })
      .set('Cookie', cookie);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('"activeMembers"');

    const crossGuild = await request(app)
      .get(`/api/v1/guilds/${guildB.id}/analytics/overview`)
      .query({ from: '2026-10-25', to: '2026-10-31' })
      .set('Cookie', cookie);
    expect(crossGuild.status).toBe(403);

    await request(app)
      .put(`/api/v1/guilds/${guildA.id}/analytics/timezone`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .send({ timezone: 'Europe/Paris' })
      .expect(204);
    expect(await analyticsRepository.getTimezone(guildA.id)).toBe(
      'Europe/Paris',
    );
  });

  it('validates date ranges and enforces export permissions', async () => {
    const repository = new MemoryRbacRepository();
    repository.contexts.set(`${userFixture.id}:${guildA.id}`, {
      membershipId: 'viewer-membership',
      roles: [
        {
          id: 'viewer-role',
          key: 'VIEWER',
          name: 'Viewer',
          rank: 10,
          isSystem: true,
          permissions: [{ key: 'analytics.view', effect: 'ALLOW' }],
        },
      ],
    });
    const authRepository = new MemoryAuthRepository();
    authRepository.memberships.set(`${userFixture.id}:${guildA.id}`, {
      id: guildA.id,
      name: guildA.name,
      role: 'OWNER',
    });
    const app = createApp({
      repository: authRepository,
      rbacRepository: repository,
      botIngestionRepository: new MemoryBotIngestionRepository(),
      analyticsRepository: new MemoryAnalyticsRepository(),
      staffModerationRepository: new MemoryStaffModerationRepository(),
      botApiSecret: environment.BOT_API_SECRET,
      discord: createDiscordClient(),
      environment,
    });
    const { cookie } = await signIn(app);
    await request(app)
      .post(`/api/v1/guilds/${guildA.id}/select`)
      .set('Cookie', cookie)
      .set('Origin', environment.APP_ORIGIN)
      .expect(200);

    const longRange = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/analytics/overview`)
      .query({ from: '2025-01-01', to: '2026-10-31' })
      .set('Cookie', cookie);
    expect(longRange.status).toBe(400);

    const forbiddenExport = await request(app)
      .get(`/api/v1/guilds/${guildA.id}/analytics/export.csv`)
      .query({ from: '2026-10-25', to: '2026-10-31' })
      .set('Cookie', cookie);
    expect(forbiddenExport.status).toBe(403);
  });
});

import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { io as createSocketClient } from 'socket.io-client';
import type { Environment } from '../src/config/env.js';
import type { AuthRepository, AuthSession } from '../src/modules/auth/types.js';
import { hashSessionToken } from '../src/modules/auth/crypto.js';
import { AuthorizationService } from '../src/modules/permissions/authorization.service.js';
import type { RbacRepository } from '../src/modules/permissions/types.js';
import { createRealtimeServer } from '../src/realtime/socket.js';

const guildId = '11111111111111111';
const otherGuildId = '22222222222222222';
const token = 'session-token-for-realtime-test';
const expiresAt = new Date(Date.now() + 60_000);

function createSession(): AuthSession {
  return {
    id: hashSessionToken(token),
    userId: 'nexus-user',
    user: {
      id: 'nexus-user',
      discordId: '33333333333333333',
      username: 'test',
      globalName: null,
      avatar: null,
    },
    encryptedAccessToken: null,
    accessTokenExpiresAt: null,
    expiresAt,
    selectedGuildId: guildId,
  };
}

describe('Socket.IO tenant authorization', () => {
  it('requires a valid session and verifies access on every guild subscription', async () => {
    const session = createSession();
    const memberships = new Set([guildId, otherGuildId]);
    const authRepository: AuthRepository = {
      upsertUser: vi.fn(),
      createSession: vi.fn(),
      findSession: vi.fn(async (id) => (id === session.id ? session : null)),
      deleteSession: vi.fn(),
      clearAccessToken: vi.fn(),
      listMemberships: vi.fn(),
      getMembership: vi.fn(async (_userId, requestedGuildId) =>
        memberships.has(requestedGuildId)
          ? { id: requestedGuildId, name: 'Test', role: 'OWNER' }
          : null,
      ),
      createOrSelectGuild: vi.fn(),
    };
    const rbacRepository: RbacRepository = {
      getAuthorizationContext: async (_userId, requestedGuildId) =>
        requestedGuildId === guildId
          ? {
              membershipId: 'membership-1',
              roles: [
                {
                  id: 'role-1',
                  key: 'OWNER',
                  name: 'Owner',
                  rank: 100,
                  isSystem: true,
                  permissions: [{ key: 'dashboard.view', effect: 'ALLOW' }],
                },
              ],
            }
          : null,
      listRoles: vi.fn(),
      createCustomRole: vi.fn(),
      updateCustomRolePermissions: vi.fn(),
      assignRole: vi.fn(),
    };
    const server = createServer();
    const environment: Environment = {
      API_PORT: 3000,
      DATABASE_URL: 'postgresql://localhost:5432/nexus',
      APP_ORIGIN: 'http://localhost:5173',
      DISCORD_CLIENT_ID: 'client-id',
      DISCORD_CLIENT_SECRET: 'client-secret',
      DISCORD_REDIRECT_URI:
        'http://localhost:3000/api/v1/auth/discord/callback',
      BOT_API_SECRET: 'b'.repeat(32),
      OAUTH_ENCRYPTION_KEY: 'a'.repeat(64),
      NODE_ENV: 'test',
    };
    const realtime = createRealtimeServer(server, {
      authRepository,
      authorization: new AuthorizationService(rbacRepository),
      environment,
    });

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Realtime test server did not start.');
    }

    const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
      forceNew: true,
      extraHeaders: {
        Cookie: `nexus_session=${encodeURIComponent(token)}`,
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', (error) => reject(error));
        const timer = setTimeout(
          () => reject(new Error('Socket connection timed out.')),
          3000,
        );
        client.once('connect', () => clearTimeout(timer));
        client.once('connect_error', () => clearTimeout(timer));
      });

      const denied = await new Promise<{ ok: boolean }>((resolve) => {
        client.emit('guild:subscribe', otherGuildId, resolve);
      });
      expect(denied).toEqual({ ok: false });
      memberships.delete(otherGuildId);
      const noMembership = await new Promise<{ ok: boolean }>((resolve) => {
        client.emit('guild:subscribe', otherGuildId, resolve);
      });
      expect(noMembership).toEqual({ ok: false });

      const allowed = await new Promise<{ ok: boolean }>((resolve) => {
        client.emit('guild:subscribe', guildId, resolve);
      });
      expect(allowed).toEqual({ ok: true });

      const foreignOriginClient = createSocketClient(
        `http://127.0.0.1:${address.port}`,
        {
          forceNew: true,
          reconnection: false,
          extraHeaders: {
            Origin: 'https://attacker.example',
            Cookie: `nexus_session=${encodeURIComponent(token)}`,
            'Sec-Fetch-Site': 'cross-site',
          },
        },
      );
      await expect(
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Foreign origin connection timed out.')),
            3000,
          );
          const clearTimer = () => clearTimeout(timer);
          foreignOriginClient.once('connect', () => {
            clearTimer();
            resolve();
          });
          foreignOriginClient.once('connect_error', (error) => {
            clearTimer();
            reject(error);
          });
        }),
      ).rejects.toBeDefined();
      foreignOriginClient.disconnect();

      const receivedUpdate = new Promise<void>((resolve) => {
        client.once('guild:updated', resolve);
      });
      await realtime.publishGuildEvent(guildId);
      await receivedUpdate;

      memberships.delete(guildId);
      const shouldNotReceiveUpdate = new Promise<void>((resolve) => {
        client.once('guild:updated', resolve);
      });
      await realtime.publishGuildEvent(guildId);
      await expect(
        Promise.race([
          shouldNotReceiveUpdate,
          new Promise((resolve) => setTimeout(resolve, 50, 'not-received')),
        ]),
      ).resolves.toBe('not-received');
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => {
        realtime.io.close(() => resolve());
      });
    }
  });
});

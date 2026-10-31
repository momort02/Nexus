import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../src/config/env.js';
import { createDiscordClient } from '../src/modules/auth/discord-client.js';

const environment = parseEnvironment({
  API_PORT: '3000',
  DATABASE_URL: 'postgresql://localhost:5432/nexus',
  APP_ORIGIN: 'http://localhost:5173',
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/discord/callback',
  BOT_API_SECRET: 'b'.repeat(64),
  OAUTH_ENCRYPTION_KEY: 'a'.repeat(64),
  NODE_ENV: 'test',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Discord client guild permissions', () => {
  it('normalizes string and safe numeric permission bitfields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: '11111111111111111',
                name: 'Guild string',
                owner: false,
                permissions: '32',
              },
              {
                id: '22222222222222222',
                name: 'Guild number',
                owner: false,
                permissions: 32,
              },
            ]),
            { status: 200 },
          ),
      ),
    );

    const guilds =
      await createDiscordClient(environment).getGuilds('access-token');

    expect(guilds.map((guild) => guild.permissions)).toEqual(['32', '32']);
  });

  it('rejects unsafe numeric permission bitfields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: '11111111111111111',
                name: 'Guild',
                owner: false,
                permissions: Number.MAX_SAFE_INTEGER + 1,
              },
            ]),
            { status: 200 },
          ),
      ),
    );

    await expect(
      createDiscordClient(environment).getGuilds('access-token'),
    ).rejects.toThrow();
  });
});
